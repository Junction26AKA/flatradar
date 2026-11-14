import { memo } from 'react';
import { AdvancedImage, lazyload, placeholder } from '@cloudinary/react';
import type { CloudinaryImage } from '@cloudinary/url-gen';

type Props = {
  cldImg: CloudinaryImage;
  lazy?: boolean;
  width?: number;
  height?: number;
  alt: string;
  className?: string;
};

/**
 * AdvancedImage re-runs its plugins on every re-render (componentDidUpdate), which swaps the loaded photo back to
 * the blurred placeholder and then fades it in again. Parents re-render often (hover, scroll, clock ticks), so we
 * only let it update when the image URL or its attributes actually change.
 */
export const CldImage = memo(
  function CldImage({ cldImg, lazy, ...rest }: Props) {
    const plugins = lazy ? [lazyload(), placeholder({ mode: 'blur' })] : [placeholder({ mode: 'blur' })];
    return <AdvancedImage cldImg={cldImg} plugins={plugins} {...rest} />;
  },
  (a, b) =>
    a.cldImg.toURL() === b.cldImg.toURL() &&
    a.lazy === b.lazy && a.width === b.width && a.height === b.height && a.alt === b.alt && a.className === b.className,
);
