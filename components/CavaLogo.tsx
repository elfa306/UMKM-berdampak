'use client';

import React from 'react';

export interface CavaVMarkProps {
  size?: number | string;
  height?: number | string;
  className?: string;
  light?: boolean;
}

/**
 * CavaVMark
 * Logo Besar (V) diambil PERSIS dari Splash.pdf
 * (Outer chevron Teal Blue #307B8E + inner inverted triangle Pastel Blue #CEE5D6)
 */
export function CavaVMark({ size, height, className = '', light = false }: CavaVMarkProps) {
  const dimension = height || size || 36;
  const numDim = typeof dimension === 'number' ? dimension : parseInt(String(dimension), 10) || 36;

  return (
    <img
      src="/cava-v-exact.webp"
      alt="CAVA V Emblem"
      width={numDim}
      height={numDim}
      className={`shrink-0 select-none object-contain inline-block ${className}`}
      style={{
        width: dimension,
        height: dimension,
        maxWidth: '100%',
      }}
      draggable={false}
    />
  );
}

export interface CavaLogoProps {
  className?: string;
  variant?: 'full' | 'mark' | 'horizontal' | 'splash';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  height?: number;
  showSubtitle?: boolean;
  light?: boolean;
}

/**
 * CavaLogo
 * Logo CAVA diambil PERSIS dari Brand Board (WhatsApp Image 2026-11-01 at 16.23.49.jpeg)
 * dan Logo Besar (V) dari Splash.pdf
 */
export function CavaLogo({
  className = '',
  variant = 'horizontal',
  size = 'md',
  height,
  showSubtitle = false,
  light = false,
}: CavaLogoProps) {
  const logoHeight = height || (size === 'sm' ? 24 : size === 'md' ? 36 : size === 'lg' ? 48 : 64);

  // 1. Variant Mark: Hanya V Emblem dari Splash.pdf
  if (variant === 'mark') {
    return <CavaVMark size={logoHeight} className={className} light={light} />;
  }

  // 2. Variant Splash: Logo V besar bertumpuk dengan teks CAVA dari Splash.pdf
  if (variant === 'splash') {
    return (
      <div className={`inline-flex flex-col items-center text-center select-none ${className}`}>
        <img
          src="/cava-v-exact.webp"
          alt="CAVA V"
          width={logoHeight * 2}
          height={logoHeight * 2}
          className="object-contain drop-shadow-md"
          style={{ width: logoHeight * 2, height: logoHeight * 2 }}
          draggable={false}
        />
        <span
          className={`font-black tracking-[0.35em] uppercase text-2xl sm:text-3xl mt-4 leading-none ${
            light ? 'text-white' : 'text-[#103A57]'
          }`}
        >
          CAVA
        </span>
        <span
          className={`text-[10px] sm:text-xs font-bold tracking-[0.35em] uppercase mt-2 ${
            light ? 'text-[#CEE5D6]' : 'text-[#307B8E]'
          }`}
        >
          Cash Value
        </span>
      </div>
    );
  }

  // 3. Variant Horizontal / Full: Logo CAVA persis dari Brand Board
  return (
    <div className={`inline-flex flex-col items-start select-none ${className}`}>
      <div className="flex items-center">
        <img
          src="/cava-logo-exact.webp"
          alt="CAVA"
          width={Math.round((logoHeight * 669) / 151)}
          height={logoHeight}
          decoding="async"
          className="object-contain"
          style={{
            height: logoHeight,
            width: 'auto',
            maxHeight: logoHeight,
          }}
          draggable={false}
        />
      </div>
      {showSubtitle && (
        <span
          className={`text-[8.5px] font-extrabold tracking-[0.28em] uppercase mt-1 pl-1 ${
            light ? 'text-[#A9D3C5]' : 'text-[#307B8E]'
          }`}
        >
          Cash Value
        </span>
      )}
    </div>
  );
}

export default CavaLogo;
