import Prism from 'prismjs';
import 'prismjs/components/prism-iecst';

// Enhance Prism's IEC 61131-3 grammar with case labels and TwinCAT attributes
const iecstGrammar = Prism.languages.iecst as Record<string, unknown> | undefined;
if (iecstGrammar) {
  if (!iecstGrammar['pragma']) {
    Prism.languages.insertBefore('iecst', 'comment', {
      pragma: {
        pattern: /\{attribute\s+['"][^'"]+['"]\}|\{[^\}\n]+\}/i,
        alias: 'attr-name',
      },
    });
  }
  if (!iecstGrammar['case-label']) {
    Prism.languages.insertBefore('iecst', 'operator', {
      'case-label': {
        pattern: /^[ \t]*[A-Za-z0-9_#]+(?:\s*,\s*[A-Za-z0-9_#]+)*\s*:(?!=)/m,
        inside: {
          punctuation: /[:,]/,
          'case-identifier': /[A-Za-z0-9_#]+/,
        },
      },
    });
  }
}

/**
 * Highlights a string of IEC 61131-3 Structured Text code into styled HTML.
 */
export function highlightStructuredText(code: string): string {
  if (!code) return '';
  try {
    if (Prism.languages.iecst) {
      return Prism.highlight(code, Prism.languages.iecst, 'iecst');
    }
  } catch (err) {
    console.warn('Failed to syntax highlight Structured Text:', err);
  }
  // Fallback: simple HTML escape
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Locates the 0-based line index of a CASE branch label in an ST code implementation block.
 * Returns -1 if not found.
 */
export function findCaseLabelLineIndex(
  implementationCode: string,
  targetStateId: string,
  targetStateLabel?: string
): number {
  if (!implementationCode || !targetStateId) return -1;
  const lines = implementationCode.split('\n');

  const candidates = new Set<string>();
  candidates.add(targetStateId.trim());
  if (targetStateLabel && targetStateLabel.trim()) {
    candidates.add(targetStateLabel.trim());
  }
  // If stateId has dot prefix (e.g. E_State.VAL), also test the unqualified VAL
  if (targetStateId.includes('.')) {
    const dotPart = targetStateId.split('.').pop();
    if (dotPart) candidates.add(dotPart.trim());
  }

  // Pass 1: Strict case label line matching (e.g. `  TABLEMANAGER_DISABLED:`)
  const caseLabelRx = /^[ \t]*([A-Za-z0-9_#]+(?:\s*,\s*[A-Za-z0-9_#]+)*)\s*:(?!=)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(caseLabelRx);
    if (match) {
      const labels = match[1].split(',').map((l) => l.trim().toLowerCase());
      for (const candidate of candidates) {
        if (labels.includes(candidate.toLowerCase())) {
          return i;
        }
      }
    }
  }

  // Pass 2: Relaxed search for candidate followed by colon or within a case list
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore lines that are comments or assignments
    if (/^[ \t]*(\/\/|\(\*)/.test(line)) continue;
    if (line.includes(':=') && !line.includes(':')) continue;

    for (const candidate of candidates) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|[,\\s])(?:[A-Za-z0-9_]+\\.)?${escaped}\\s*:(?!=)`, 'i');
      if (pattern.test(line)) {
        return i;
      }
    }
  }

  return -1;
}
