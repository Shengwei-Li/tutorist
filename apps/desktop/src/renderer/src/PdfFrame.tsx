import { useEffect, useState } from 'react';

/** Shows PDF bytes in Chromium's built-in viewer via a blob URL (revoked on change). */
export function PdfFrame({ pdf, className = 'h-[640px]' }: { pdf: Uint8Array; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pdf]);
  if (!url) return null;
  return <iframe data-testid="pdf" title="PDF preview" src={url} className={`w-full rounded-sm border border-border bg-white ${className}`} />;
}
