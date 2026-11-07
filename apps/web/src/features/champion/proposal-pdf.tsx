import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { ProposalDocument } from './ProposalDocument.tsx';

/**
 * 企画書＋審査レポートを PDF にしてダウンロードする。
 * ブラウザの中で紙面を描いて画像化するので、日本語フォントをそのまま使え、サーバーに重い処理を足さない。
 * （文字は画像になるため PDF 上で選択できない。必要なら将来サーバー側生成に切り替える）
 */
export async function downloadProposalPdf(snapshot: SessionSnapshot) {
  const content = snapshot.proposal?.content;
  if (!content || !snapshot.champion) throw new Error('proposal not ready');

  const host = document.createElement('div');
  // 画面外に置いて描画する（display:none だと描けないため）
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ProposalDocument snapshot={snapshot} content={content} />));
    await document.fonts.ready;
    await waitForImages(host);
    const { default: html2pdf } = await import('html2pdf.js');
    const filename = `IDEA_AUDITION_企画書_${sanitize(content.title)}.pdf`;
    // pagebreak は型定義に無いが html2pdf.js の正式なオプション
    const options: Record<string, unknown> = {
        margin: [10, 0, 12, 0],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        // 表の行や合意のカードの途中でページが切れないようにする
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h2'] },
    };
    await html2pdf()
      .set(options as never)
      .from(host.firstElementChild as HTMLElement)
      .save();
  } finally {
    root.unmount();
    host.remove();
  }
}

function sanitize(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

async function waitForImages(el: HTMLElement) {
  // マスコットは CSS の背景画像なので、同じ画像を読み込んで描画前にキャッシュに乗せる
  const urls = new Set<string>();
  el.querySelectorAll<HTMLElement>('[style*="background-image"]').forEach((n) => {
    const m = n.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (m?.[1]) urls.add(m[1]);
  });
  await Promise.all(
    [...urls].map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
}
