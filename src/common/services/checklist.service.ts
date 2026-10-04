import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ServiceChecklist,
  ChecklistItem,
  BookingChecklistProgress,
  ChecklistItemProgress,
  ServiceType,
  ChecklistPhase,
} from 'src/database/entities';

@Injectable()
export class ChecklistService implements OnModuleInit {
  private readonly logger = new Logger(ChecklistService.name);

  constructor(
    @InjectRepository(ServiceChecklist)
    private readonly checklistRepo: Repository<ServiceChecklist>,
    @InjectRepository(ChecklistItem)
    private readonly itemRepo: Repository<ChecklistItem>,
    @InjectRepository(BookingChecklistProgress)
    private readonly progressRepo: Repository<BookingChecklistProgress>,
    @InjectRepository(ChecklistItemProgress)
    private readonly itemProgressRepo: Repository<ChecklistItemProgress>,
  ) {}

  /**
   * Auto-seed the default checklist templates the first time the app boots
   * against a database that has none yet, so bookings always have a
   * checklist to initialize instead of silently getting an empty one.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaultChecklists();
    } catch (err) {
      this.logger.error('Failed to seed default checklists', err as Error);
    }
  }

  /**
   * Get or create checklist for a booking
   */
  async initializeChecklistForBooking(
    bookingId: string,
    serviceType: ServiceType,
  ): Promise<BookingChecklistProgress> {
    // Check if checklist already exists
    let progress = await this.progressRepo.findOne({
      where: { bookingId },
      relations: ['itemProgress', 'itemProgress.checklistItem'],
    });

    if (progress) {
      return progress;
    }

    // Create new checklist progress
    progress = this.progressRepo.create({
      bookingId,
      serviceType,
      currentPhase: 'POST_SERVICE',
      status: 'PENDING',
      completionPercentage: 0,
    });

    await this.progressRepo.save(progress);

    await this.initializePhaseItems(progress.id, serviceType, 'POST_SERVICE');

    return progress;
  }

  /**
   * Load checklist template for a specific service type and phase
   */
  async getChecklistForPhase(
    serviceType: ServiceType,
    phase: ChecklistPhase,
  ): Promise<ServiceChecklist | null> {
    return this.checklistRepo.findOne({
      where: {
        serviceType,
        phase,
        isActive: true,
      },
      relations: ['items'],
      order: {
        items: {
          sequenceOrder: 'ASC',
        },
      },
    });
  }

  /**
   * Initialize checklist items for a specific phase
   */
  private async initializePhaseItems(
    checklistProgressId: string,
    serviceType: ServiceType,
    phase: ChecklistPhase,
  ): Promise<void> {
    const template = await this.getChecklistForPhase(serviceType, phase);

    if (!template) {
      return;
    }

    const itemProgresses = template.items.map((item) =>
      this.itemProgressRepo.create({
        checklistProgressId,
        checklistItemId: item.id,
        isCompleted: false,
      }),
    );

    await this.itemProgressRepo.save(itemProgresses);
  }

  /**
   * Get current checklist progress for a booking
   */
  async getBookingChecklistProgress(
    bookingId: string,
  ): Promise<BookingChecklistProgress | null> {
    return this.progressRepo.findOne({
      where: { bookingId },
      relations: [
        'itemProgress',
        'itemProgress.checklistItem',
        'itemProgress.checklistItem.checklist',
      ],
      order: {
        itemProgress: {
          checklistItem: {
            sequenceOrder: 'ASC',
          },
        },
      },
    });
  }

  /**
   * Mark a checklist item as complete
   */
  async completeChecklistItem(
    checklistProgressId: string,
    checklistItemId: string,
    photoUrl?: string,
    notes?: string,
  ): Promise<ChecklistItemProgress> {
    const itemProgress = await this.itemProgressRepo.findOne({
      where: {
        checklistProgressId,
        checklistItemId,
      },
      relations: ['checklistProgress'],
    });

    if (!itemProgress) {
      throw new NotFoundException('Checklist item progress not found');
    }

    itemProgress.isCompleted = true;
    itemProgress.completedAt = new Date();
    if (photoUrl) itemProgress.photoUrl = photoUrl;
    if (notes) itemProgress.notes = notes;

    await this.itemProgressRepo.save(itemProgress);

    // Update checklist progress completion percentage
    await this.updateCompletionPercentage(checklistProgressId);

    return itemProgress;
  }

  /**
   * Mark a checklist item as incomplete
   */
  async uncompleteChecklistItem(
    checklistProgressId: string,
    checklistItemId: string,
  ): Promise<ChecklistItemProgress> {
    const itemProgress = await this.itemProgressRepo.findOne({
      where: {
        checklistProgressId,
        checklistItemId,
      },
    });

    if (!itemProgress) {
      throw new NotFoundException('Checklist item progress not found');
    }

    itemProgress.isCompleted = false;
    itemProgress.completedAt = null;

    await this.itemProgressRepo.save(itemProgress);

    // Update completion percentage
    await this.updateCompletionPercentage(checklistProgressId);

    return itemProgress;
  }

  /**
   * Move to next phase and initialize items
   */
  async moveToNextPhase(
    checklistProgressId: string,
  ): Promise<BookingChecklistProgress> {
    const progress = await this.progressRepo.findOne({
      where: { id: checklistProgressId },
    });

    if (!progress) {
      throw new NotFoundException('Checklist progress not found');
    }

    let nextPhase: ChecklistPhase;

    switch (progress.currentPhase) {
      case 'PRE_SERVICE':
        nextPhase = 'DURING_SERVICE';
        break;
      case 'DURING_SERVICE':
        nextPhase = 'POST_SERVICE';
        break;
      case 'POST_SERVICE':
        // Already at last phase
        return progress;
      default:
        throw new Error(`Invalid phase: ${progress.currentPhase}`);
    }

    progress.currentPhase = nextPhase;
    progress.status = 'IN_PROGRESS';
    await this.progressRepo.save(progress);

    // Initialize items for the new phase
    await this.initializePhaseItems(
      checklistProgressId,
      progress.serviceType as ServiceType,
      nextPhase,
    );

    return progress;
  }

  /**
   * Mark phase as completed
   */
  async completePhase(checklistProgressId: string): Promise<BookingChecklistProgress> {
    const progress = await this.progressRepo.findOne({
      where: { id: checklistProgressId },
    });

    if (!progress) {
      throw new NotFoundException('Checklist progress not found');
    }

    // Check if all required items are completed
    const itemProgresses = await this.itemProgressRepo.find({
      where: { checklistProgressId },
      relations: ['checklistItem', 'checklistItem.checklist'],
    });

    const requiredItems = itemProgresses.filter(
      (ip) =>
        ip.checklistItem.isRequired &&
        ip.checklistItem.checklist?.phase === progress.currentPhase,
    );
    const allRequiredCompleted = requiredItems.every((ip) => ip.isCompleted);

    if (!allRequiredCompleted) {
      throw new Error('Cannot complete phase: not all required items are completed');
    }

    // Auto-transition to next phase if available
    if (progress.currentPhase !== 'POST_SERVICE') {
      return this.moveToNextPhase(checklistProgressId);
    } else {
      progress.status = 'COMPLETED';
      await this.progressRepo.save(progress);
    }

    return progress;
  }

  /**
   * Calculate and update completion percentage
   */
  private async updateCompletionPercentage(checklistProgressId: string): Promise<void> {
    const itemProgresses = await this.itemProgressRepo.find({
      where: { checklistProgressId },
    });

    if (itemProgresses.length === 0) {
      return;
    }

    const completed = itemProgresses.filter((ip) => ip.isCompleted).length;
    const percentage = Math.round((completed / itemProgresses.length) * 100);

    await this.progressRepo.update(checklistProgressId, {
      completionPercentage: percentage,
    });
  }

  /**
   * Get checklist template for display/setup
   */
  async getChecklistTemplate(
    serviceType: ServiceType,
    phase: ChecklistPhase,
  ): Promise<ServiceChecklist | null> {
    return this.checklistRepo.findOne({
      where: {
        serviceType,
        phase,
        isActive: true,
      },
      relations: ['items'],
      order: {
        items: {
          sequenceOrder: 'ASC',
        },
      },
    });
  }

  /**
   * Seed default checklists (for development/setup).
   * Idempotent — skips entirely if any templates already exist, so it's
   * safe to call on every app boot (see onModuleInit above).
   */
  async seedDefaultChecklists(): Promise<void> {
    const existingCount = await this.checklistRepo.count();
    if (existingCount > 0) {
      return;
    }

    // COOK checklists
    const cookPreService = this.checklistRepo.create({
      serviceType: 'COOK',
      checklistName: 'Pre-Service Setup',
      phase: 'PRE_SERVICE',
      description: 'Tasks to complete before starting cooking service',
      isActive: true,
    });

    const cookPreItems = [
      {
        taskName: 'Verify kitchen hygiene',
        description: 'Check kitchen cleanliness and setup',
        sequenceOrder: 1,
        isRequired: true,
        requiresPhoto: true,
      },
      {
        taskName: 'Check ingredients availability',
        description: 'Confirm all ingredients are available and fresh',
        sequenceOrder: 2,
        isRequired: true,
        requiresNotes: true,
      },
      {
        taskName: 'Confirm menu with customer',
        description: 'Verify the menu details with the customer',
        sequenceOrder: 3,
        isRequired: true,
        requiresNotes: true,
      },
      {
        taskName: 'Check cooking equipment',
        description: 'Verify stove and utensils are in good condition',
        sequenceOrder: 4,
        isRequired: true,
        estimatedTimeMinutes: 5,
      },
    ];

    await this.checklistRepo.save(cookPreService);
    for (const item of cookPreItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cookPreService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }

    // COOK during service
    const cookDuringService = this.checklistRepo.create({
      serviceType: 'COOK',
      checklistName: 'Service Execution',
      phase: 'DURING_SERVICE',
      description: 'Tasks during cooking service',
      isActive: true,
    });

    const cookDuringItems = [
      {
        taskName: 'Prepare starter',
        sequenceOrder: 1,
        isRequired: true,
        estimatedTimeMinutes: 15,
        requiresPhoto: true,
      },
      {
        taskName: 'Prepare main course',
        sequenceOrder: 2,
        isRequired: true,
        estimatedTimeMinutes: 45,
        requiresPhoto: true,
      },
      {
        taskName: 'Prepare dessert',
        sequenceOrder: 3,
        isRequired: false,
        estimatedTimeMinutes: 20,
        requiresPhoto: false,
      },
      {
        taskName: 'Plating & presentation',
        sequenceOrder: 4,
        isRequired: true,
        estimatedTimeMinutes: 10,
        requiresPhoto: true,
      },
    ];

    await this.checklistRepo.save(cookDuringService);
    for (const item of cookDuringItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cookDuringService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }

    // COOK post service
    const cookPostService = this.checklistRepo.create({
      serviceType: 'COOK',
      checklistName: 'Post-Service Cleanup',
      phase: 'POST_SERVICE',
      description: 'Tasks after cooking is complete',
      isActive: true,
    });

    const cookPostItems = [
      {
        taskName: 'Clean cooking area',
        sequenceOrder: 1,
        isRequired: true,
        estimatedTimeMinutes: 10,
        requiresPhoto: true,
      },
      {
        taskName: 'Dispose of waste properly',
        sequenceOrder: 2,
        isRequired: true,
        estimatedTimeMinutes: 5,
      },
      {
        taskName: 'Get customer signature',
        sequenceOrder: 3,
        isRequired: true,
      },
      {
        taskName: 'Request feedback rating',
        sequenceOrder: 4,
        isRequired: true,
      },
    ];

    await this.checklistRepo.save(cookPostService);
    for (const item of cookPostItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cookPostService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }

    // Similar setup for CLEANING service...
    const cleaningPreService = this.checklistRepo.create({
      serviceType: 'CLEANING',
      checklistName: 'Pre-Cleaning Inspection',
      phase: 'PRE_SERVICE',
      description: 'Initial inspection before cleaning starts',
      isActive: true,
    });

    const cleaningPreItems = [
      {
        taskName: 'Inspect area to be cleaned',
        sequenceOrder: 1,
        isRequired: true,
        requiresPhoto: true,
      },
      {
        taskName: 'Identify special stains/areas',
        sequenceOrder: 2,
        isRequired: true,
        requiresNotes: true,
      },
      {
        taskName: 'Confirm cleaning plan',
        sequenceOrder: 3,
        isRequired: true,
        requiresNotes: true,
      },
      {
        taskName: 'Arrange furniture if needed',
        sequenceOrder: 4,
        isRequired: false,
        estimatedTimeMinutes: 10,
      },
    ];

    await this.checklistRepo.save(cleaningPreService);
    for (const item of cleaningPreItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cleaningPreService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }

    // CLEANING during service
    const cleaningDuringService = this.checklistRepo.create({
      serviceType: 'CLEANING',
      checklistName: 'Cleaning Execution',
      phase: 'DURING_SERVICE',
      description: 'Tasks during the cleaning service',
      isActive: true,
    });

    const cleaningDuringItems = [
      {
        taskName: 'Dust and wipe surfaces',
        sequenceOrder: 1,
        isRequired: true,
        estimatedTimeMinutes: 20,
        requiresPhoto: false,
      },
      {
        taskName: 'Sweep and mop floors',
        sequenceOrder: 2,
        isRequired: true,
        estimatedTimeMinutes: 25,
        requiresPhoto: true,
      },
      {
        taskName: 'Clean bathroom & fixtures',
        sequenceOrder: 3,
        isRequired: true,
        estimatedTimeMinutes: 20,
        requiresPhoto: true,
      },
      {
        taskName: 'Kitchen deep clean',
        sequenceOrder: 4,
        isRequired: false,
        estimatedTimeMinutes: 20,
        requiresPhoto: true,
      },
      {
        taskName: 'Trash removal',
        sequenceOrder: 5,
        isRequired: true,
        estimatedTimeMinutes: 5,
      },
    ];

    await this.checklistRepo.save(cleaningDuringService);
    for (const item of cleaningDuringItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cleaningDuringService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }

    // CLEANING post service
    const cleaningPostService = this.checklistRepo.create({
      serviceType: 'CLEANING',
      checklistName: 'Post-Cleaning Handover',
      phase: 'POST_SERVICE',
      description: 'Tasks after cleaning is complete',
      isActive: true,
    });

    const cleaningPostItems = [
      {
        taskName: 'Final walkthrough inspection',
        sequenceOrder: 1,
        isRequired: true,
        estimatedTimeMinutes: 5,
        requiresPhoto: true,
      },
      {
        taskName: 'Return furniture to place',
        sequenceOrder: 2,
        isRequired: false,
        estimatedTimeMinutes: 5,
      },
      {
        taskName: 'Get customer signature',
        sequenceOrder: 3,
        isRequired: true,
      },
      {
        taskName: 'Request feedback rating',
        sequenceOrder: 4,
        isRequired: true,
      },
    ];

    await this.checklistRepo.save(cleaningPostService);
    for (const item of cleaningPostItems) {
      const checklistItem = this.itemRepo.create({
        checklistId: cleaningPostService.id,
        ...item,
      });
      await this.itemRepo.save(checklistItem);
    }
  }
}
