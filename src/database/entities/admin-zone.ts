import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Admin } from './admin';
import { ServiceArea } from './service-area';

@Entity('admin_zones')
@Unique('admin_zones_unique', ['adminId', 'serviceAreaId'])
export class AdminZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId: string;

  @Column({ name: 'service_area_id', type: 'uuid' })
  serviceAreaId: string;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  @ManyToOne(() => ServiceArea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_area_id' })
  serviceArea: ServiceArea;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
