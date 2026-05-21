import { cn } from '@/shared/lib/utils';

interface LogoProps {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  stacked?: boolean;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="U2Claw"
      className={cn('size-8 shrink-0', className)}
    >
      <defs>
        <linearGradient id="u2claw-logo-mark" x1="12" y1="54" x2="52" y2="8">
          <stop offset="0" stopColor="#ffd84d" />
          <stop offset="0.46" stopColor="#ff7a1a" />
          <stop offset="1" stopColor="#ff4d00" />
        </linearGradient>
      </defs>
      <path
        fill="url(#u2claw-logo-mark)"
        d="M36.9 5.7c6.1-1.5 10.7 2.8 9.8 9.1-.5 3.7.8 5.7 4.2 6.5 5.6 1.4 8.1 6.5 5.8 11.8C52.8 42 45.5 53.8 33 56.8 20.4 59.8 8.6 52.9 6.2 42.8 3.6 32 9.6 20.3 20.4 15.8c5.4-2.3 9.2-8.3 16.5-10.1Z"
      />
      <path
        fill="#fff"
        fillOpacity="0.92"
        d="M18.2 33.6c-.9-.2-1.4-1.1-1.1-2 .9-3.8 3.5-7.1 7-8.9.8-.4 1.8-.1 2.2.7.4.8.1 1.8-.7 2.2-2.7 1.4-4.7 3.9-5.4 6.8-.2.8-.8 1.2-1.6 1.2h-.4Zm8.1 2c-.9-.2-1.4-1.1-1.1-2 .5-2.1 1.9-3.8 3.8-4.8.8-.4 1.8-.1 2.2.7.4.8.1 1.8-.7 2.2-1.1.6-1.9 1.6-2.2 2.8-.2.8-.9 1.2-1.6 1.2l-.4-.1Zm20 4.4c-.8-.4-1.1-1.4-.7-2.2 1.4-2.7 1.7-5.9.7-8.8-.3-.9.1-1.8 1-2.1.9-.3 1.8.1 2.1 1 1.3 3.7 1 7.9-.9 11.4-.3.5-.9.9-1.5.9-.2 0-.5-.1-.7-.2Zm-6.4-5.4c-.8-.4-1.1-1.4-.7-2.2.5-1 .6-2.1.2-3.2-.3-.9.1-1.8 1-2.1.9-.3 1.8.1 2.1 1 .7 1.9.5 4.1-.5 5.9-.3.5-.9.9-1.5.9-.2-.1-.4-.2-.6-.3Z"
      />
      <circle cx="33" cy="35" r="4.4" fill="#1f2937" />
    </svg>
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-sidebar-foreground text-lg leading-none font-bold',
        className
      )}
    >
      U2<span className="text-primary">Claw</span>
    </span>
  );
}

export function Logo({
  className,
  markClassName,
  showWordmark = false,
  stacked = false,
}: LogoProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        stacked && 'flex-col gap-1.5',
        className
      )}
    >
      <LogoMark className={markClassName} />
      {showWordmark && <LogoWordmark />}
    </div>
  );
}
