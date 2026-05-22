import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/providers/language-provider';
import { getVersion } from '@tauri-apps/api/app';

import { LogoMark } from '@/components/common/logo';

export function AboutSettings() {
  const { t } = useLanguage();
  const [version, setVersion] = useState('0.0.0');

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('0.0.0'));
  }, []);

  return (
    <div className="space-y-6">
      {/* Product Info */}
      <div className="flex items-center gap-4">
        <LogoMark className="size-16" />
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-foreground text-xl font-bold">unisound</h2>
            <p className="text-muted-foreground text-sm">
              {t.settings.aiPlatform}
            </p>
          </div>
        </div>
      </div>

      {/* Version & Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.version}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {version}
          </p>
        </div>
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.build}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {__BUILD_DATE__}
          </p>
        </div>
      </div>

      {/* Author & Copyright */}
      <div className="space-y-3">
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.author}
          </span>
          <span className="text-foreground text-sm font-medium">unisound</span>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.copyright}
          </span>
          <span className="text-foreground text-sm font-medium">
            © 2026 unisound
          </span>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.license}
          </span>
          <span className="text-foreground text-sm font-medium">unisound</span>
        </div>
      </div>
    </div>
  );
}
