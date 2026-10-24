import { PartialType } from '@nestjs/swagger';
import { CreateCouponRuleDto } from './create-coupon-rule.dto';

export class UpdateCouponRuleDto extends PartialType(CreateCouponRuleDto) {}
