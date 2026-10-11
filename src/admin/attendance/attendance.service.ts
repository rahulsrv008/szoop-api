import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AgentAttendance } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminAttendanceDto } from './dto/list-attendance.dto';
import { AdminAttendanceReportDto } from './dto/attendance-report.dto';

interface AttendanceRow {
  id: string;
  agentId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  attendanceDate: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string | null;
}

interface ReportRow {
  agentId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  presentDays: number;
  totalHours: string | null;
  lastCheckIn: Date | null;
}

/** Local calendar date, so IST mornings do not report yesterday. */
function localDate(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function hoursBetween(checkIn: Date | null, checkOut: Date | null) {
  if (!checkIn || !checkOut) return null;
  const hours = (checkOut.getTime() - checkIn.getTime()) / 3_600_000;
  return hours > 0 ? Number(hours.toFixed(2)) : 0;
}

/**
 * Read-only workforce attendance for the Admin Web app. Rows are written by the
 * Agent app (`POST /agent/attendance/check-in|check-out`); admins never edit
 * them, so there is no mutation endpoint here.
 */
@Injectable()
export class AdminAttendanceService {
  constructor(
    @InjectRepository(AgentAttendance)
    private readonly attendanceRepo: Repository<AgentAttendance>,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminAttendanceDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(), query)
      .select('attendance.id', 'id')
      .addSelect('attendance.agentId', 'agentId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('user.mobile', 'mobile')
      // `date` columns come back as a local-midnight Date in raw queries, which
      // shifts a day backwards once serialised in IST.
      .addSelect("to_char(attendance.attendanceDate, 'YYYY-MM-DD')", 'attendanceDate')
      .addSelect('attendance.checkIn', 'checkIn')
      .addSelect('attendance.checkOut', 'checkOut')
      .addSelect('attendance.status', 'status')
      .orderBy('attendance.attendanceDate', 'DESC')
      .addOrderBy('attendance.checkIn', 'DESC', 'NULLS LAST')
      .offset(skip)
      .limit(take);

    const totalsQb = this.applyFilters(this.baseQuery(), query)
      .select('COUNT(*)::int', 'records')
      .addSelect(
        'COUNT(DISTINCT (attendance.agent_id, attendance.attendance_date))::int',
        'presentDays',
      )
      .addSelect('COUNT(attendance.check_out)::int', 'completedShifts')
      .addSelect(
        `COALESCE(SUM(
           EXTRACT(EPOCH FROM (attendance.check_out - attendance.check_in))
         ) / 3600, 0)`,
        'totalHours',
      );

    const [rows, total, totals] = await Promise.all([
      rowsQb.getRawMany<AttendanceRow>(),
      this.applyFilters(this.baseQuery(), query).getCount(),
      totalsQb.getRawOne<{
        records: number;
        presentDays: number;
        completedShifts: number;
        totalHours: string;
      }>(),
    ]);

    const page = paginated(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
        agentMobile: row.mobile,
        attendanceDate: row.attendanceDate,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        hoursWorked: hoursBetween(row.checkIn, row.checkOut),
        status: row.status ?? (row.checkOut ? 'CHECKED_OUT' : 'CHECKED_IN'),
      })),
      total,
      query,
    );

    return {
      ...page,
      totals: {
        records: Number(totals?.records ?? 0),
        presentDays: Number(totals?.presentDays ?? 0),
        completedShifts: Number(totals?.completedShifts ?? 0),
        totalHours: Number(Number(totals?.totalHours ?? 0).toFixed(2)),
      },
    };
  }

  /** Per-agent aggregation for the attendance report screen. */
  async report(query: AdminAttendanceReportDto) {
    const { from, to } = this.reportRange(query);

    const qb = this.baseQuery()
      .andWhere('attendance.attendanceDate >= :from', { from })
      .andWhere('attendance.attendanceDate <= :to', { to })
      .select('attendance.agentId', 'agentId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('user.mobile', 'mobile')
      .addSelect(
        'COUNT(DISTINCT attendance.attendance_date)::int',
        'presentDays',
      )
      .addSelect(
        `COALESCE(SUM(
           EXTRACT(EPOCH FROM (attendance.check_out - attendance.check_in))
         ) / 3600, 0)`,
        'totalHours',
      )
      .addSelect('MAX(attendance.check_in)', 'lastCheckIn')
      .groupBy('attendance.agentId')
      .addGroupBy('agent.firstName')
      .addGroupBy('agent.lastName')
      .addGroupBy('user.mobile')
      .orderBy('"totalHours"', 'DESC');

    if (query.agentId) {
      qb.andWhere('attendance.agentId = :agentId', { agentId: query.agentId });
    }

    const rows = await qb.getRawMany<ReportRow>();

    const items = rows.map((row) => {
      const presentDays = Number(row.presentDays ?? 0);
      const totalHours = Number(Number(row.totalHours ?? 0).toFixed(2));
      return {
        agentId: row.agentId,
        agentName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
        agentMobile: row.mobile,
        presentDays,
        totalHours,
        averageHours: presentDays
          ? Number((totalHours / presentDays).toFixed(2))
          : 0,
        lastCheckIn: row.lastCheckIn,
      };
    });

    return {
      range: { from, to },
      items,
      totals: {
        agents: items.length,
        presentDays: items.reduce((sum, row) => sum + row.presentDays, 0),
        totalHours: Number(
          items.reduce((sum, row) => sum + row.totalHours, 0).toFixed(2),
        ),
      },
    };
  }

  private baseQuery() {
    return this.attendanceRepo
      .createQueryBuilder('attendance')
      .innerJoin('attendance.agent', 'agent')
      .innerJoin('agent.user', 'user');
  }

  private applyFilters(
    qb: SelectQueryBuilder<AgentAttendance>,
    query: ListAdminAttendanceDto,
  ) {
    if (query.search) {
      qb.andWhere(
        "(agent.firstName || ' ' || COALESCE(agent.lastName, '')) ILIKE :search",
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.agentId) {
      qb.andWhere('attendance.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.status) {
      qb.andWhere('attendance.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('attendance.attendanceDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('attendance.attendanceDate <= :to', { to: query.to });
    }
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }

  private reportRange(query: AdminAttendanceReportDto) {
    const to = query.to ?? localDate(new Date());
    const from =
      query.from ??
      localDate(new Date(new Date(`${to}T00:00:00`).getTime() - 29 * 86_400_000));
    return { from, to };
  }
}
