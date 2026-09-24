import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { exportHighResPng } from './diagramExport.ts';

export interface PrintToPdfOptions {
  /** Target element to capture (defaults to #mermaid-canvas-area) */
  targetElement?: HTMLElement | null;
  /** Fallback element ID if targetElement is not provided */
  targetElementId?: string;
  /** File name without extension (default: 'statechart-diagram') */
  fileName?: string;
  /** Scale factor for high-resolution rendering (default: 2 for Retina quality) */
  scale?: number;
  /** Diagram theme: 'dark' | 'forest' | 'neutral' | 'default' */
  theme?: string;
  /** Optional title to show at the top of the PDF */
  title?: string;
  /** Whether to fill the PDF page background to match the diagram theme */
  fillPageBackground?: boolean;
}

export interface PrintToPdfResult {
  success: boolean;
  fileName?: string;
  error?: string;
}

/**
 * Captures the current visible area of the Mermaid diagram and exports it as a high-resolution PDF.
 */
export async function exportDiagramVisibleAreaToPdf(
  options: PrintToPdfOptions = {}
): Promise<PrintToPdfResult> {
  const {
    targetElement,
    targetElementId = 'mermaid-canvas-area',
    fileName = 'statechart-diagram',
    scale = 2,
    theme = 'dark',
    title,
    fillPageBackground = true,
  } = options;

  try {
    // 1. Resolve target element
    let element: HTMLElement | null = targetElement || null;
    if (!element && targetElementId) {
      element = document.getElementById(targetElementId);
    }
    if (!element) {
      element =
        document.getElementById('mermaid-canvas-area') ||
        document.getElementById('mermaid-viewer-container') ||
        document.querySelector('.mermaid-viewer-wrapper') as HTMLElement | null;
    }

    if (!element) {
      return {
        success: false,
        error: 'Diagram visible canvas element could not be found.',
      };
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return {
        success: false,
        error: 'Diagram visible canvas has zero dimensions.',
      };
    }

    // Determine background color based on theme
    const isDark =
      theme === 'dark' ||
      element.classList.contains('bg-slate-900') ||
      getComputedStyle(element).backgroundColor === 'rgb(15, 23, 42)';

    let bgColor = isDark ? '#0f172a' : '#f8fafc';
    if (theme === 'forest') bgColor = '#f4f7f4';
    if (theme === 'neutral') bgColor = '#f5f5f4';

    // 2. Render visible area using html2canvas-pro with fallback to SVG rasterizer
    let canvasWidth: number;
    let canvasHeight: number;
    let imgData: string;

    try {
      const canvas = await html2canvas(element, {
        scale: Math.max(1, Math.min(4, scale)), // high-resolution multiplier
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: bgColor,
        width: element.clientWidth,
        height: element.clientHeight,
        scrollX: 0,
        scrollY: 0,
        ignoreElements: (el: Element) => {
          const id = el.id || '';
          const classStr = el.className ? String(el.className) : '';
          // Ignore snap grid SVG pattern (can be 16000px wide)
          if (id === 'diagram-snap-grid-svg' || id.includes('snap-grid')) return true;
          // Ignore floating toasts, menus, and overlays
          if (id === 'snap-status-toast') return true;
          if (id === 'heatmap-state-hover-tooltip') return true;
          if (id === 'diagram-context-menu') return true;
          if (id === 'export-toast-notification') return true;
          if (id === 'layout-lock-toast-notification') return true;
          // Ignore minimap overlay on visible capture
          if (id === 'diagram-minimap-container' || id === 'diagram-minimap-collapsed') return true;
          if (classStr.includes('diagram-minimap')) return true;
          // Ignore manual ignore class
          if (el.classList && el.classList.contains('tc-pdf-ignore')) return true;
          return false;
        },
        onclone: (clonedDoc: Document) => {
          // Additional cleanup on cloned DOM
          const snapGrid = clonedDoc.getElementById('diagram-snap-grid-svg');
          if (snapGrid) {
            snapGrid.remove();
          }
          const hoverTooltip = clonedDoc.getElementById('heatmap-state-hover-tooltip');
          if (hoverTooltip) {
            hoverTooltip.remove();
          }
          const minimap = clonedDoc.getElementById('diagram-minimap-container');
          if (minimap) {
            minimap.remove();
          }
        },
      });

      canvasWidth = canvas.width;
      canvasHeight = canvas.height;
      imgData = canvas.toDataURL('image/png', 1.0);
    } catch (h2cError) {
      console.warn('html2canvas capture failed, falling back to vector SVG rasterization:', h2cError);
      const svgEl = (element.querySelector('svg') ||
        document.querySelector('#mermaid-canvas-area svg') ||
        document.querySelector('#mermaid-viewer-container svg')) as SVGSVGElement | null;
      if (!svgEl) {
        throw h2cError;
      }
      const exportRes = await exportHighResPng(svgEl, {
        scale: Math.max(1, Math.min(4, scale)) as 1 | 2 | 3 | 4,
        background: isDark ? 'dark' : 'white',
        theme,
      });
      canvasWidth = exportRes.width;
      canvasHeight = exportRes.height;
      if (exportRes.dataUrl) {
        imgData = exportRes.dataUrl;
      } else {
        imgData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(exportRes.blob);
        });
      }
    }

    if (canvasWidth === 0 || canvasHeight === 0) {
      return {
        success: false,
        error: 'Generated canvas has zero area.',
      };
    }

    // 3. Configure jsPDF
    const isLandscape = canvasWidth >= canvasHeight;
    const orientation = isLandscape ? 'landscape' : 'portrait';

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Fill PDF background to match theme
    if (fillPageBackground) {
      if (isDark) {
        pdf.setFillColor(15, 23, 42); // slate-900
      } else if (theme === 'forest') {
        pdf.setFillColor(244, 247, 244);
      } else if (theme === 'neutral') {
        pdf.setFillColor(245, 245, 244);
      } else {
        pdf.setFillColor(248, 250, 252); // slate-50
      }
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    }

    // Margins
    const margin = 8; // mm
    const titleAreaHeight = title ? 10 : 0;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2 - titleAreaHeight;

    // Calculate dimensions maintaining aspect ratio
    const imgAspect = canvasWidth / canvasHeight;
    const pageAspect = maxWidth / maxHeight;

    let renderWidth: number;
    let renderHeight: number;

    if (imgAspect > pageAspect) {
      renderWidth = maxWidth;
      renderHeight = maxWidth / imgAspect;
    } else {
      renderHeight = maxHeight;
      renderWidth = maxHeight * imgAspect;
    }

    // Center image on the page
    const x = margin + (maxWidth - renderWidth) / 2;
    const y = margin + titleAreaHeight + (maxHeight - renderHeight) / 2;

    // Render optional title
    if (title) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      if (isDark) {
        pdf.setTextColor(226, 232, 240); // slate-200
      } else {
        pdf.setTextColor(30, 41, 59); // slate-800
      }
      pdf.text(title, margin, margin + 5);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      if (isDark) {
        pdf.setTextColor(148, 163, 184); // slate-400
      } else {
        pdf.setTextColor(100, 116, 139); // slate-500
      }
      const timestamp = new Date().toLocaleString();
      pdf.text(`Captured: ${timestamp}`, pageWidth - margin, margin + 5, {
        align: 'right',
      });
    }

    // Convert canvas to image and add to PDF
    pdf.addImage(
      imgData,
      'PNG',
      x,
      y,
      renderWidth,
      renderHeight,
      undefined,
      'FAST'
    );

    // Metadata
    pdf.setProperties({
      title: `${fileName} - Statechart Diagram`,
      subject: 'TwinCAT 3 POU Statechart Architecture Diagram',
      creator: 'TwinCAT POU Statechart Generator',
    });

    const finalFileName = `${fileName}.pdf`;
    pdf.save(finalFileName);

    return {
      success: true,
      fileName: finalFileName,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Failed to export diagram to PDF:', err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
