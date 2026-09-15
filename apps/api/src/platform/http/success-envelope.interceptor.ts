import { Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

type HttpResponse = { statusCode?: number };
type HttpRequest = { requestId?: string; id?: string };

@Injectable()
export class SuccessEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const request = context.switchToHttp().getRequest<HttpRequest>();

    return next.handle().pipe(
      map((data: unknown) => {
        // Responses without a body, streams, and files must retain their native shape.
        if (response.statusCode === 204 || data instanceof StreamableFile || isStreamLike(data)) {
          return data;
        }

        return {
          data,
          meta: { requestId: request.requestId ?? request.id ?? '' },
        };
      }),
    );
  }
}

function isStreamLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { pipe?: unknown; on?: unknown; arrayBuffer?: unknown };
  return (
    typeof candidate.pipe === 'function' ||
    (typeof candidate.on === 'function' && typeof candidate.arrayBuffer !== 'function')
  );
}
