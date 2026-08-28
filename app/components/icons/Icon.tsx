import type { LucideIcon, LucideProps } from 'lucide-react';

export interface IconProps extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon;
  decorative?: boolean;
}

export function Icon({ icon: IconComponent, size = 18, decorative = true, ...props }: IconProps) {
  return (
    <IconComponent
      aria-hidden={decorative ? true : undefined}
      focusable={decorative ? false : undefined}
      size={size}
      {...props}
    />
  );
}
