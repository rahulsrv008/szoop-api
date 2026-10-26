import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Agent,
  AgentAvailability,
  AgentBankAccount,
  AgentDocument,
  AgentEarning,
  AgentLocation,
  Booking,
  Rating,
} from 'src/database/entities';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { ReferralService } from 'src/common/referrals/referral.service';
import { formatEmployeeId, normalizeEmployeeId } from 'src/common/referrals/employee-id';
import { ListAdminAgentsDto } from './dto/list-agents.dto';
import { ApproveAdminAgentDto } from './dto/approve-agent.dto';
import { AssignAdminAgentZonesDto } from './dto/assign-agent-zones.dto';
import { RejectAdminAgentDto } from './dto/reject-agent.dto';
import { SuspendAdminAgentDto } from './dto/suspend-agent.dto';
import { VerifyAdminAgentDocumentDto } from './dto/verify-document.dto';
import { todayString } from 'src/agent/shared/date.util';

interface AgentListRow {
  agentId: string;
  userId: string;
  employeeId: string | null;
  firstName: string;
  lastName: string | null;
  mobile: string;
  status: string;
  approvalStatus: string;
  joiningDate: string | null;
  createdAt: Date;
  profileImage: string | null;
  documentsVerified: number;
  averageRating: string;
  completedBookings: number;
  homeZoneId: string | null;
  serviceAreas: string[] | null;
  currentLocation: Agent['currentLocation'];
}

@Injectable()
export class AdminAgentsService {
  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentDocument)
    private readonly documentRepo: Repository<AgentDocument>,
    @InjectRepository(AgentBankAccount)
    private readonly bankRepo: Repository<AgentBankAccount>,
    @InjectRepository(AgentAvailability)
    private readonly availabilityRepo: Repository<AgentAvailability>,
    @InjectRepository(AgentEarning)
    private readonly earningRepo: Repository<AgentEarning>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Rating) private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(AgentLocation)
    private readonly locationRepo: Repository<AgentLocation>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
    private readonly zones: ZoneResolverService,
    private readonly access: AdminAccessService,
    private readonly referrals: ReferralService,
  ) {}

  async list(query: ListAdminAgentsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(
      this.agentRepo
        .createQueryBuilder('agent')
        .innerJoin('agent.user', 'user'),
      query,
    )
      .select('agent.id', 'agentId')
      .addSelect('agent.userId', 'userId')
      .addSelect('agent.employeeId', 'employeeId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('user.mobile', 'mobile')
      .addSelect('agent.status', 'status')
      .addSelect('agent.approvalStatus', 'approvalStatus')
      .addSelect(`to_char(agent.joiningDate, 'YYYY-MM-DD')`, 'joiningDate')
      .addSelect('agent.createdAt', 'createdAt')
      .addSelect(
        `(SELECT COUNT(*)::int FROM agent_documents doc
           WHERE doc.agent_id = agent.id AND doc.verification_status = 'VERIFIED')`,
        'documentsVerified',
      )
      .addSelect(
        `(SELECT COALESCE(AVG(rt.rating), 0) FROM ratings rt
           WHERE rt.agent_id = agent.id)`,
        'averageRating',
      )
      .addSelect(
        `(SELECT COUNT(*)::int FROM bookings bk
           WHERE bk.agent_id = agent.id AND bk.status = 'completed')`,
        'completedBookings',
      )
      .addSelect('agent.homeZoneId', 'homeZoneId')
      .addSelect('agent.serviceAreas', 'serviceAreas')
      .addSelect('agent.currentLocation', 'currentLocation')
      .orderBy('agent.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    if (query.approvalStatus === 'PENDING') {
      rowsQb.addSelect(
        `COALESCE(
          agent.profileImage,
          (SELECT doc.document_url
             FROM agent_documents doc
            WHERE doc.agent_id = agent.id AND doc.document_type = 'PHOTO'
            ORDER BY doc.created_at DESC
            LIMIT 1)
        )`,
        'profileImage',
      );
    }

    const countQb = this.applyFilters(
      this.agentRepo
        .createQueryBuilder('agent')
        .innerJoin('agent.user', 'user'),
      query,
    );

    const [rows, total] = await Promise.all([
      rowsQb.getRawMany<AgentListRow>(),
      countQb.getCount(),
    ]);

    const zoneMap = await this.zones.summariesById([
      ...rows.map((row) => row.homeZoneId),
      ...rows.flatMap((row) => row.serviceAreas ?? []),
    ]);

    return paginated(
      rows.map((row) => ({
        agentId: row.agentId,
        employeeId: formatEmployeeId(row.employeeId),
        name: this.fullName(row.firstName, row.lastName),
        mobile: row.mobile,
        status: row.status,
        approvalStatus: row.approvalStatus,
        profileImage: row.profileImage ?? null,
        documentsVerified: Number(row.documentsVerified),
        averageRating: Number(Number(row.averageRating ?? 0).toFixed(2)),
        completedBookings: Number(row.completedBookings),
        joiningDate: row.joiningDate,
        homeZone: row.homeZoneId ? zoneMap.get(row.homeZoneId) ?? null : null,
        serviceAreas: (row.serviceAreas ?? [])
          .map((id) => zoneMap.get(id))
          .filter((zone): zone is NonNullable<typeof zone> => !!zone),
        currentLocation: row.currentLocation ?? null,
      })),
      total,
      query,
    );
  }

  async detail(id: string) {
    const agent = await this.requireAgent(id);

    const [
      documents,
      bankAccount,
      availability,
      ratingSummary,
      monthEarnings,
      lifetimeEarnings,
      recentBookings,
      referredBy,
    ] = await Promise.all([
      this.documentRepo.find({
        where: { agentId: id },
        order: { createdAt: 'DESC' },
      }),
      this.bankRepo.findOne({
        where: { agentId: id },
        order: { createdAt: 'DESC' },
      }),
      this.availabilityRepo.find({
        where: { agentId: id, availabilityDate: todayString() },
        order: { startTime: 'ASC' },
      }),
      this.ratingRepo
        .createQueryBuilder('rating')
        .select('COALESCE(AVG(rating.rating), 0)', 'average')
        .addSelect('COUNT(*)::int', 'count')
        .where('rating.agentId = :id', { id })
        .getRawOne<{ average: string; count: number }>(),
      this.earningRepo
        .createQueryBuilder('earning')
        .select('COALESCE(SUM(earning.earningAmount), 0)', 'total')
        .where('earning.agentId = :id', { id })
        // Month from the app clock (pinned to APP_TIMEZONE), not the DB session's zone.
        .andWhere(`date_trunc('month', earning.earningDate) = date_trunc('month', CAST(:today AS date))`, {
          today: todayString(),
        })
        .getRawOne<{ total: string }>(),
      this.earningRepo
        .createQueryBuilder('earning')
        .select('COALESCE(SUM(earning.earningAmount), 0)', 'total')
        .where('earning.agentId = :id', { id })
        .getRawOne<{ total: string }>(),
      this.bookingRepo.find({
        where: { agentId: id },
        order: { bookingDate: 'DESC', startTime: 'DESC' },
        take: 10,
      }),
      agent.referredByAgentId
        ? this.agentRepo.findOne({
            where: { id: agent.referredByAgentId },
            select: ['id', 'firstName', 'lastName', 'employeeId'],
          })
        : null,
    ]);

    return {
      agentId: agent.id,
      userId: agent.userId,
      employeeId: formatEmployeeId(agent.employeeId),
      referredBy: referredBy
        ? {
            agentId: referredBy.id,
            name: this.fullName(referredBy.firstName, referredBy.lastName),
            employeeId: formatEmployeeId(referredBy.employeeId),
          }
        : null,
      mobile: agent.user.mobile,
      email: agent.user.email,
      isUserActive: agent.user.isActive,
      firstName: agent.firstName,
      lastName: agent.lastName,
      name: this.fullName(agent.firstName, agent.lastName),
      profileImage:
        agent.profileImage ??
        documents.find((document) => document.documentType === 'PHOTO')
          ?.documentUrl ??
        null,
      gender: agent.gender,
      dateOfBirth: agent.dateOfBirth,
      status: agent.status,
      approvalStatus: agent.approvalStatus,
      joiningDate: agent.joiningDate,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      homeZone: await this.zones.summaryById(agent.homeZoneId),
      serviceAreas: await this.zones.listSummaries(agent.serviceAreas ?? []),
      currentLocation: agent.currentLocation,
      address: {
        addressLine1: agent.addressLine1,
        locality: agent.locality,
        city: agent.city,
        state: agent.state,
        pincode: agent.pincode,
        latitude: agent.latitude === null ? null : Number(agent.latitude),
        longitude: agent.longitude === null ? null : Number(agent.longitude),
      },
      documents,
      bankAccount: bankAccount
        ? {
            id: bankAccount.id,
            accountHolderName: bankAccount.accountHolderName,
            accountNumber: this.maskAccountNumber(bankAccount.accountNumber),
            ifscCode: bankAccount.ifscCode,
            bankName: bankAccount.bankName,
            isVerified: bankAccount.isVerified,
            createdAt: bankAccount.createdAt,
          }
        : null,
      availabilityToday: availability,
      ratings: {
        average: Number(Number(ratingSummary?.average ?? 0).toFixed(2)),
        count: Number(ratingSummary?.count ?? 0),
      },
      earnings: {
        thisMonth: Number(monthEarnings?.total ?? 0),
        lifetime: Number(lifetimeEarnings?.total ?? 0),
      },
      recentBookings: recentBookings.map((booking) => ({
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        status: booking.status,
        totalAmount: Number(booking.totalAmount),
      })),
    };
  }

  async approve(adminId: string, id: string, dto: ApproveAdminAgentDto) {
    const agent = await this.requireAgent(id);

    if (!['PENDING', 'REJECTED'].includes(agent.approvalStatus)) {
      throw new BadRequestException(
        `Agent approval status is ${agent.approvalStatus}, nothing to approve`,
      );
    }

    // Onboarding prerequisites: a name, at least one uploaded document and
    // payout details, otherwise the agent cannot be paid after a job.
    const [documentCount, bankAccount] = await Promise.all([
      this.documentRepo.count({ where: { agentId: id } }),
      this.bankRepo.findOne({ where: { agentId: id }, select: ['id'] }),
    ]);

    const missing: string[] = [];
    if (!agent.firstName?.trim()) missing.push('first name');
    if (!documentCount) missing.push('at least one document');
    if (!bankAccount) missing.push('a bank account');
    if (!dto.serviceAreaIds?.length) missing.push('at least one service location');
    if (missing.length) {
      throw new BadRequestException(
        `Agent profile is incomplete: missing ${missing.join(', ')}`,
      );
    }

    const oldData = {
      approvalStatus: agent.approvalStatus,
      status: agent.status,
      joiningDate: agent.joiningDate,
      homeZoneId: agent.homeZoneId,
      serviceAreas: agent.serviceAreas ?? [],
    };

    await this.applyCoverage(agent, dto.serviceAreaIds, dto.homeZoneId);

    agent.approvalStatus = 'APPROVED';
    agent.status = 'ACTIVE';
    if (!agent.joiningDate) agent.joiningDate = todayString();
    await this.agentRepo.save(agent);
    agent.employeeId = await this.referrals.assignEmployeeId(agent.id);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: 'You are approved',
      message: dto.remarks
        ? `Your ClearIt agent account is approved. ${dto.remarks}`
        : 'Your ClearIt agent account is approved. You can start accepting jobs.',
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'AGENT_APPROVED',
      entityType: 'agents',
      entityId: agent.id,
      oldData,
      newData: {
        approvalStatus: agent.approvalStatus,
        status: agent.status,
        joiningDate: agent.joiningDate,
        homeZoneId: agent.homeZoneId,
        serviceAreas: agent.serviceAreas,
        employeeId: agent.employeeId,
        remarks: dto.remarks ?? null,
      },
    });

    return this.statusResponse(agent, 'Agent approved.');
  }

  async assignZones(adminId: string, id: string, dto: AssignAdminAgentZonesDto) {
    const agent = await this.requireAgent(id);
    const oldData = {
      homeZoneId: agent.homeZoneId,
      serviceAreas: agent.serviceAreas ?? [],
    };

    await this.applyCoverage(agent, dto.serviceAreaIds, dto.homeZoneId);
    await this.agentRepo.save(agent);

    await this.audit.record({
      userId: adminId,
      action: 'AGENT_ZONES_ASSIGNED',
      entityType: 'agents',
      entityId: agent.id,
      oldData,
      newData: {
        homeZoneId: agent.homeZoneId,
        serviceAreas: agent.serviceAreas,
      },
    });

    return this.statusResponse(agent, 'Service locations updated.');
  }

  async reject(adminId: string, id: string, dto: RejectAdminAgentDto) {
    const agent = await this.requireAgent(id);
    const oldData = {
      approvalStatus: agent.approvalStatus,
      status: agent.status,
    };

    agent.approvalStatus = 'REJECTED';
    agent.status = 'PENDING';
    await this.agentRepo.save(agent);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: 'Application rejected',
      message: `Your ClearIt agent application was rejected. Reason: ${dto.reason}`,
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'AGENT_REJECTED',
      entityType: 'agents',
      entityId: agent.id,
      oldData,
      newData: {
        approvalStatus: agent.approvalStatus,
        status: agent.status,
        reason: dto.reason,
      },
    });

    return this.statusResponse(agent, 'Agent application rejected.');
  }

  async suspend(adminId: string, id: string, dto: SuspendAdminAgentDto) {
    const agent = await this.requireAgent(id);

    const ongoing = await this.bookingRepo.count({
      where: { agentId: id, status: 'ongoing' },
    });
    if (ongoing) {
      throw new BadRequestException(
        'Agent has a job in progress — wait for it to finish before suspending',
      );
    }

    const oldData = { status: agent.status };
    agent.status = 'SUSPENDED';
    await this.agentRepo.save(agent);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: 'Account suspended',
      message: `Your ClearIt agent account has been suspended. Reason: ${dto.reason}`,
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'AGENT_SUSPENDED',
      entityType: 'agents',
      entityId: agent.id,
      oldData,
      newData: { status: agent.status, reason: dto.reason },
    });

    return this.statusResponse(agent, 'Agent suspended.');
  }

  async activate(adminId: string, id: string) {
    const agent = await this.requireAgent(id);

    if (agent.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Only suspended agents can be activated (current status: ${agent.status})`,
      );
    }
    if (agent.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Approve the agent before activating them');
    }

    const oldData = { status: agent.status };
    agent.status = 'ACTIVE';
    await this.agentRepo.save(agent);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: 'Account reactivated',
      message: 'Your ClearIt agent account is active again. Welcome back!',
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'AGENT_ACTIVATED',
      entityType: 'agents',
      entityId: agent.id,
      oldData,
      newData: { status: agent.status },
    });

    return this.statusResponse(agent, 'Agent activated.');
  }

  /** KYC screen: verify or reject one uploaded document. */
  async verifyDocument(
    adminId: string,
    id: string,
    documentId: string,
    dto: VerifyAdminAgentDocumentDto,
  ) {
    const agent = await this.requireAgent(id);
    const document = await this.documentRepo.findOne({
      where: { id: documentId, agentId: id },
    });
    if (!document) throw new NotFoundException('Document not found');

    const oldData = {
      verificationStatus: document.verificationStatus,
      verifiedAt: document.verifiedAt,
    };

    const verified = dto.verificationStatus === 'VERIFIED';
    document.verificationStatus = dto.verificationStatus;
    document.verifiedAt = verified ? new Date() : null;
    await this.documentRepo.save(document);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: verified ? 'Document verified' : 'Document rejected',
      message: verified
        ? `Your ${document.documentType} has been verified.`
        : `Your ${document.documentType} was rejected.${
            dto.remarks ? ` Reason: ${dto.remarks}` : ''
          }`,
      type: 'kyc',
    });

    await this.audit.record({
      userId: adminId,
      action: verified ? 'AGENT_DOCUMENT_VERIFIED' : 'AGENT_DOCUMENT_REJECTED',
      entityType: 'agent_documents',
      entityId: document.id,
      oldData,
      newData: {
        verificationStatus: document.verificationStatus,
        verifiedAt: document.verifiedAt,
        remarks: dto.remarks ?? null,
      },
    });

    return {
      agentId: agent.id,
      documentId: document.id,
      documentType: document.documentType,
      verificationStatus: document.verificationStatus,
      verifiedAt: document.verifiedAt,
    };
  }

  /** Latest GPS ping plus recent history for the live-location screen. */
  async location(id: string) {
    await this.requireAgent(id);

    const pings = await this.locationRepo.find({
      where: { agentId: id },
      order: { recordedAt: 'DESC' },
      take: 50,
    });

    const latest = pings[0] ?? null;
    return {
      agentId: id,
      latest: latest
        ? {
            id: latest.id,
            bookingId: latest.bookingId,
            latitude: latest.latitude,
            longitude: latest.longitude,
            recordedAt: latest.recordedAt,
          }
        : null,
      recent: pings.map((ping) => ({
        id: ping.id,
        bookingId: ping.bookingId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        recordedAt: ping.recordedAt,
      })),
    };
  }

  private applyFilters(
    qb: SelectQueryBuilder<Agent>,
    query: ListAdminAgentsDto,
  ) {
    if (query.search) {
      // Employee IDs match however they're typed: "sz26-k7m", "SZ26K7M".
      const idSearch = normalizeEmployeeId(query.search);
      qb.andWhere(
        `(agent.firstName ILIKE :search OR agent.lastName ILIKE :search
          OR user.mobile ILIKE :search${idSearch ? ' OR agent.employeeId LIKE :idSearch' : ''})`,
        { search: `%${query.search.trim()}%`, idSearch: `%${idSearch}%` },
      );
    }
    if (query.approvalStatus) {
      qb.andWhere('agent.approvalStatus = :approvalStatus', {
        approvalStatus: query.approvalStatus,
      });
    }
    if (query.status) {
      qb.andWhere('agent.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('agent.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('agent.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }

  private async applyCoverage(
    agent: Agent,
    serviceAreaIds: string[],
    homeZoneId?: string | null,
  ) {
    const areas = await this.zones.requireAreas(serviceAreaIds);
    agent.serviceAreas = areas.map((area) => area.id);
    if (homeZoneId) {
      await this.zones.requireAreas([homeZoneId]);
      agent.homeZoneId = homeZoneId;
    }
  }

  private async requireAgent(id: string) {
    const agent = await this.agentRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!agent) throw new NotFoundException('Agent not found');
    this.access.assertAgent(agent);
    return agent;
  }

  private statusResponse(agent: Agent, message: string) {
    return {
      agentId: agent.id,
      employeeId: formatEmployeeId(agent.employeeId),
      status: agent.status,
      approvalStatus: agent.approvalStatus,
      joiningDate: agent.joiningDate,
      homeZoneId: agent.homeZoneId,
      serviceAreas: agent.serviceAreas ?? [],
      currentLocation: agent.currentLocation,
      message,
    };
  }

  private maskAccountNumber(accountNumber: string | null) {
    if (!accountNumber) return null;
    const trimmed = accountNumber.trim();
    if (trimmed.length <= 4) return trimmed;
    return `${'X'.repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
