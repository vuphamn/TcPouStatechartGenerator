/**
 * An HTML document printed (the system's print dialog: a printer, or Save as PDF) without opening a window: from a
 * hidden frame in this page (XAE's WebView2, the desktop app and browsers alike); the frame removed afterwards.
 * Resolves false when the frame could not print (its print blocked).
 */
export function printHtml(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.id = 'kss-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    const done = (ok: boolean) => {
      // (left a moment: some engines print after print() returns)
      window.setTimeout(() => frame.remove(), 1000);
      resolve(ok);
    };
    frame.onload = () => {
      try {
        const w = frame.contentWindow;
        if (!w) return done(false);
        w.focus();
        w.print();
        done(true);
      } catch {
        done(false);
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
