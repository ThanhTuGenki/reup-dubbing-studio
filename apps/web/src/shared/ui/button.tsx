import { forwardRef, type ButtonHTMLAttributes } from 'react';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className = '', variant = 'primary', ...props }, ref) { return <button ref={ref} className={`button button-${variant} ${className}`.trim()} {...props} />; });
