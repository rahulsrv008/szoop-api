import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import {
  AgentAvailability,
  Booking,
  BookingStatusHistory,
  BookingVisit,
  Rating,
  SalaryRecord,
} from 'src/database/entities';
import { AgentContextService } from '../shared/agent-context.service';
import { monthRange, toDateString, todayString, weekStartString } from '../shared/date.util';

/** A job counts as on time when it starts (customer OTP) within this many minutes of its slot. */
const ON_TIME_GRACE_MINUTES = 10;
/** A start→complete span longer than this is a forgotten "complete", so the booked duration is used. */
const MAX_JOB_HOURS = 12;
/** Past months of salary shown, besides the current one. */
const PAST_SALARY_MONTHS = 6;

type DoneJob = {
  bookingId: string;
  /** The slot it was booked for. */
  scheduledAt: Date;
  completedAt: Date;
  bookedMinutes: number;
};

type Worked = DoneJob & { startedAt: Date | null; hours: number };

/**
 * What a salaried agent's app shows instead of money per job: work done
 * (jobs, hours, days online, on-time starts) and the monthly salary the admin
 * sets. A plan's visits each count as a job; a single booking counts once.
 */
@Injectable()
export class AgentWorkSummaryService {
  constructor(
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingVisit) private readonly visitRepo: Repository<BookingVisit>,
    @InjectRepository(BookingStatusHistory)
    private readonly historyRepo: Repository<BookingStatusHistory>,
    @InjectRepository(AgentAvailability)
    private readonly availabilityRepo: Repository<AgentAvailability>,
    @InjectRepository(SalaryRecord) private readonly salaryRepo: Repository<SalaryRecord>,
    @InjectRepository(Rating) private readonly ratingRepo: Repository<Rating>,
    private readonly context: AgentContextService,
  ) {}

  async summary(userId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    const now = new Date();
    const today = todayString();
    const month = monthRange(now);
    const weekStart = weekStartString(now);
    const sevenDaysAgo = toDateString(addDays(now, -6));
    const oldestMonth = new Date(now.getFullYear(), now.getMonth() - PAST_SALARY_MONTHS, 1);

    const since = new Date(
      Math.min(oldestMonth.getTime(), dayStart(weekStart).getTime(), dayStart(sevenDaysAgo).getTime()),
    );
    const [jobs, lifetimeJobs, daysOnline, salaries, rating] = await Promise.all([
      this.doneJobs(agent.id, since).then((done) => this.withHours(done)),
      this.lifetimeJobs(agent.id),
      this.availabilityRepo.count({
        where: {
          agentId: agent.id,
          isAvailable: true,
          availabilityDate: Between(month.from, today),
        },
      }),
      this.salaryRepo.find({
        where: { agentId: agent.id },
        order: { year: 'DESC', month: 'DESC' },
        take: PAST_SALARY_MONTHS + 1,
      }),
      this.rating(agent.id),
    ]);

    const on = (from: string, to: string) =>
      jobs.filter((job) => {
        const day = toDateString(job.completedAt);
        return day >= from && day <= to;
      });
    const thisMonth = on(month.from, month.to);
    const started = thisMonth.filter((job) => job.startedAt);
    const onTime = started.filter(
      (job) => job.startedAt!.getTime() <= job.scheduledAt.getTime() + ON_TIME_GRACE_MINUTES * 60_000,
    );

    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const date = toDateString(addDays(now, index - 6));
      const day = on(date, date);
      return { date, jobs: day.length, hours: totalHours(day) };
    });

    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const current = salaries.find((row) => row.month === currentMonth && row.year === currentYear);
    const past = salaries
      .filter((row) => row.year * 12 + row.month < currentYear * 12 + currentMonth)
      .slice(0, PAST_SALARY_MONTHS)
      .map((row) => {
        const range = monthRange(new Date(row.year, row.month - 1, 1));
        const worked = on(range.from, range.to);
        return { ...toSalary(row), jobs: worked.length, hours: totalHours(worked) };
      });

    return {
      today: { jobsDone: on(today, today).length },
      week: { from: weekStart, hours: totalHours(on(weekStart, today)) },
      month: {
        month: currentMonth,
        year: currentYear,
        jobsCompleted: thisMonth.length,
        hoursWorked: totalHours(thisMonth),
        daysOnline,
        // Null until a job this month has a recorded start, so the app shows "—" rather than 0%.
        onTimePercent: started.length ? Math.round((onTime.length / started.length) * 100) : null,
        onTimeGraceMinutes: ON_TIME_GRACE_MINUTES,
      },
      last7Days,
      salary: { current: current ? toSalary(current) : null, past },
      rating,
      lifetime: { jobsCompleted: lifetimeJobs, joiningDate: agent.joiningDate ?? null },
    };
  }

  /** Done plan visits plus completed single bookings, finished since `since`. */
  private async doneJobs(agentId: string, since: Date): Promise<DoneJob[]> {
    const visits = await this.visitRepo
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.booking', 'booking')
      .where('booking.agent_id = :agentId', { agentId })
      .andWhere("visit.status = 'done'")
      .andWhere('visit.completed_at >= :since', { since })
      .getMany();

    const singles = await this.historyRepo
      .createQueryBuilder('history')
      .innerJoinAndSelect('history.booking', 'booking')
      .where('booking.agent_id = :agentId', { agentId })
      .andWhere("history.status = 'completed'")
      .andWhere("booking.status = 'completed'")
      .andWhere('history.created_at >= :since', { since })
      .andWhere('NOT EXISTS (SELECT 1 FROM booking_visits v WHERE v.booking_id = booking.id)')
      .orderBy('history.created_at', 'ASC')
      .getMany();

    const seen = new Set<string>();
    const singleJobs: DoneJob[] = [];
    for (const row of singles) {
      // A single booking completes once; a duplicate history row must not count twice.
      if (seen.has(row.bookingId)) continue;
      seen.add(row.bookingId);
      singleJobs.push({
        bookingId: row.bookingId,
        scheduledAt: slot(row.booking.bookingDate, row.booking.startTime),
        completedAt: row.createdAt,
        bookedMinutes: row.booking.durationMinutes,
      });
    }

    return [
      ...visits.map((visit) => ({
        bookingId: visit.bookingId,
        scheduledAt: slot(visit.visitDate, visit.startTime),
        completedAt: visit.completedAt as Date,
        bookedMinutes: visit.booking.durationMinutes,
      })),
      ...singleJobs,
    ];
  }

  /** Hours from the OTP start to completion; the booked duration when no usable start was recorded. */
  private async withHours(jobs: DoneJob[]): Promise<Worked[]> {
    const ids = [...new Set(jobs.map((job) => job.bookingId))];
    const starts = ids.length
      ? await this.historyRepo.find({
          where: { bookingId: In(ids), status: 'ongoing' },
          order: { createdAt: 'ASC' },
        })
      : [];
    const byBooking = new Map<string, Date[]>();
    for (const row of starts) {
      const list = byBooking.get(row.bookingId) ?? [];
      list.push(row.createdAt);
      byBooking.set(row.bookingId, list);
    }

    return jobs.map((job) => {
      // The latest start before this completion: a plan starts once per visit.
      const startedAt =
        [...(byBooking.get(job.bookingId) ?? [])]
          .reverse()
          .find((at) => at.getTime() <= job.completedAt.getTime()) ?? null;
      const span = startedAt ? (job.completedAt.getTime() - startedAt.getTime()) / 3_600_000 : null;
      const hours = span !== null && span > 0 && span <= MAX_JOB_HOURS ? span : job.bookedMinutes / 60;
      return { ...job, startedAt, hours };
    });
  }

  /** Average stars, how many, and the latest two reviews that have words. */
  private async rating(agentId: string) {
    const [stats, latest] = await Promise.all([
      this.ratingRepo
        .createQueryBuilder('rating')
        .select('AVG(rating.rating)', 'average')
        .addSelect('COUNT(rating.id)', 'count')
        .where('rating.agent_id = :agentId', { agentId })
        .getRawOne<{ average: string | null; count: string }>(),
      this.ratingRepo
        .createQueryBuilder('rating')
        .innerJoinAndSelect('rating.reviews', 'review')
        .leftJoinAndSelect('rating.customer', 'customer')
        .where('rating.agent_id = :agentId', { agentId })
        .andWhere("COALESCE(TRIM(review.review_text), '') <> ''")
        // With take() over joins TypeORM wants the property name here, not the column.
        .orderBy('rating.createdAt', 'DESC')
        .take(2)
        .getMany(),
    ]);
    const count = Number(stats?.count ?? 0);
    return {
      average: count ? Number(Number(stats?.average ?? 0).toFixed(1)) : null,
      count,
      latest: latest.map((row) => ({
        stars: Number(row.rating),
        text: row.reviews[0]?.reviewText ?? '',
        customerFirstName: row.customer?.firstName ?? null,
        createdAt: row.createdAt,
      })),
    };
  }

  private async lifetimeJobs(agentId: string) {
    const [visits, singles] = await Promise.all([
      this.visitRepo
        .createQueryBuilder('visit')
        .innerJoin('visit.booking', 'booking')
        .where('booking.agent_id = :agentId', { agentId })
        .andWhere("visit.status = 'done'")
        .getCount(),
      this.bookingRepo
        .createQueryBuilder('booking')
        .where('booking.agent_id = :agentId', { agentId })
        .andWhere("booking.status = 'completed'")
        .andWhere('NOT EXISTS (SELECT 1 FROM booking_visits v WHERE v.booking_id = booking.id)')
        .getCount(),
    ]);
    return visits + singles;
  }
}

function toSalary(row: SalaryRecord) {
  return {
    month: row.month,
    year: row.year,
    fixedSalary: Number(row.fixedSalary),
    incentive: Number(row.incentive),
    referralBonus: Number(row.referralBonus),
    deductions: Number(row.deductions),
    netSalary: Number(row.netSalary),
    status: row.status,
  };
}

function totalHours(jobs: Worked[]) {
  return Math.round(jobs.reduce((sum, job) => sum + job.hours, 0) * 10) / 10;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dayStart(ymd: string) {
  return new Date(`${ymd}T00:00:00`);
}

/** A booked slot in local (India) time; `date` may come back as a Date or 'YYYY-MM-DD'. */
function slot(date: string | Date, time: string) {
  const day = typeof date === 'string' ? date.slice(0, 10) : toDateString(date);
  return new Date(`${day}T${time || '00:00:00'}`);
}
