import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminReferralsService } from './referrals.service';
import { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto';
import { ReverseReferralRewardDto } from './dto/reverse-reward.dto';

/** Agent referral program: settings, each agent's referrals, reversing a reward. */
@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.REFERRALS)
export class AdminReferralsController {
  constructor(private readonly referralsService: AdminReferralsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Referral program settings in force, and who last changed them' })
  getSettings() {
    return this.referralsService.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Save the referral program settings (applies from now on)' })
  updateSettings(
    @CurrentUser('sub') adminId: string,
    @Body() dto: UpdateReferralSettingsDto,
  ) {
    return this.referralsService.updateSettings(adminId, dto);
  }

  @Get('agents/:id')
  @ApiOperation({
    summary: "An agent's referrals: earnings by level, reward history with reasons, team",
  })
  agentReferrals(@Param('id', ParseUUIDPipe) id: string) {
    return this.referralsService.agentReferrals(id);
  }

  @Post('rewards/:id/reverse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back a pending or paid referral reward' })
  reverse(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseReferralRewardDto,
  ) {
    return this.referralsService.reverseReward(adminId, id, dto);
  }
}
