import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

type ContainerSize = {
  width: number;
  height: number;
};

export function useFitContainerSize<T extends HTMLElement>(ref: RefObject<T | null>): ContainerSize | null {
  const [size, setSize] = useState<ContainerSize | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return size;
}
