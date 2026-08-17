import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import { MOTION } from './src/lib/motion/tokens';

// ============================================================
// Tailwind config - shadcn/ui style với theme dark + vuông vức
// ============================================================
//
// Theme dùng CSS variables (định nghĩa trong index.css) — chuẩn shadcn,
// dễ thay theme runtime nếu sau này muốn light mode.
//
// borderRadius giữ 0 tuyệt đói — shadcn components vẫn render OK.
//
// Motion values (transitionDuration, transitionTimingFunction) import tu
// src/lib/motion/tokens.ts — SSOT gop 1 cho. Doi tokens.ts → tailwind + JS
// deu update, khong drift.
// ============================================================

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    // Override hoàn toàn: chỉ cho phép radius = 0
    // Exception: `full` giữ = 9999px cho avatar tròn (avatar là data element,
    // không phải chrome UI — theme "vuông vức" không áp dụng).
    borderRadius: {
      none: '0',
      DEFAULT: '0',
      sm: '0',
      md: '0',
      lg: '0',
      xl: '0',
      full: '9999px',
    },
    extend: {
      colors: {
        // shadcn semantic tokens (đọc từ CSS vars)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // Legacy tokens (giữ tương thích với code đã viết)
        bg: {
          primary: 'hsl(var(--background))',
          secondary: 'hsl(var(--card))',
          elevated: 'hsl(var(--popover))',
          hover: 'hsl(var(--muted))',
        },
        text: {
          primary: 'hsl(var(--foreground))',
          secondary: 'hsl(var(--secondary-foreground))',
          muted: 'hsl(var(--muted-foreground))',
        },
        danger: {
          DEFAULT: 'hsl(var(--destructive))',
          hover: 'hsl(var(--destructive))',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      transitionDuration: {
        // Derived tu MOTION.duration (SSOT: src/lib/motion/tokens.ts).
        // Doi tokens.ts → tailwind class + JS animation cung update, khong drift.
        fast: `${MOTION.duration.fast * 1000}ms`,
        normal: `${MOTION.duration.normal * 1000}ms`,
        slow: `${MOTION.duration.slow * 1000}ms`,
      },
      transitionTimingFunction: {
        // Derived tu MOTION.easing.standard.
        standard: `cubic-bezier(${MOTION.easing.standard.join(',')})`,
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: { height: '0' },
        },
        indeterminate: {
          '0%': {
            transform: 'translateX(-100%)',
          },
          '100%': {
            transform: 'translateX(400%)',
          },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        breathe: {
          '50%': { transform: 'scale(0.92, 1.04)' },
        },
        mouth: {
          '50%': { transform: 'scaleY(0.6)' },
        },
        bubble: {
          '50%': { transform: 'scale(1.5)', opacity: '0.6' },
        },
        'shadow-pulse': {
          '50%': { transform: 'translateX(-50%) scaleX(0.75)' },
        },
        // Design System v2 — idle float for empty-state icons
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        // Subtle destructive glow pulse for error states
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--destructive) / 0.18)' },
          '50%': { boxShadow: '0 0 16px 2px hsl(var(--destructive) / 0.18)' },
        },
        // Focus ring scale-in (from inside out)
        'ring-in': {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // Post-drop flash for bookmarks DnD — subtle ring pulse expanding
        // outward from the just-moved item. Không tô background nên không
        // ảnh hưởng nội dung item. Duration 400ms để cảm giác responsive.
        'drop-flash': {
          '0%': {
            boxShadow: '0 0 0 0 hsl(var(--primary) / 0)',
            transform: 'scale(1)',
          },
          '25%': {
            boxShadow: '0 0 0 4px hsl(var(--primary) / 0.45)',
            transform: 'scale(1.04)',
          },
          '100%': {
            boxShadow: '0 0 0 8px hsl(var(--primary) / 0)',
            transform: 'scale(1)',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        indeterminate:
          'indeterminate 1.5s infinite ease-in-out',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        breathe: 'breathe 2s ease-in-out infinite',
        mouth: 'mouth 2s ease-in-out infinite',
        bubble: 'bubble 2s ease-in-out infinite',
        'shadow-pulse': 'shadow-pulse 2s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.4s ease-in-out infinite',
        'ring-in': 'ring-in 0.2s cubic-bezier(0.4,0,0.2,1) both',
        'drop-flash': 'drop-flash 400ms cubic-bezier(0.2,0,0,1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
