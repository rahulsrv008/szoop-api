import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthUser } from '../types/auth.types';
import { AdminAccessService, adminAccessStore } from 'src/common/auth/admin-access';

@Injectable()
export class AdminAccessInterceptor implements NestInterceptor {
  constructor(private readonly access: AdminAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (request.user?.role !== 'admin') return next.handle();

    return from(this.access.load(request.user.sub)).pipe(
      switchMap(
        (access) =>
          new Observable((subscriber) => {
            adminAccessStore.run(access, () => {
              next.handle().subscribe(subscriber);
            });
          }),
      ),
    );
  }
}
