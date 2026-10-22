import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { MOBILE_MESSAGE, MOBILE_REGEX } from 'src/common/utils/validation';

/** The customer app has its own SendOtpDto; Swagger needs the two schemas named apart. */
@ApiSchema({ name: 'AgentSendOtpDto' })
export class SendOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(MOBILE_REGEX, { message: MOBILE_MESSAGE })
  mobile: string;
}
