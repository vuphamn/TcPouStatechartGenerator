/**
 * Utilities for extracting POU (Program Organization Unit) and Method hierarchy
 * information from Beckhoff TwinCAT 3 .TcPOU files.
 */

export type PouType = 'FUNCTION_BLOCK' | 'PROGRAM' | 'FUNCTION' | 'POU';

export interface MethodSignatureInfo {
  name: string;
  returnType?: string;
  accessModifier?: 'PUBLIC' | 'PRIVATE' | 'PROTECTED' | 'INTERNAL';
  isStateMethod?: boolean;
}

export interface PouHierarchyMetadata {
  fileName: string;
  pouName: string;
  pouType: PouType;
  pouTypeShort: string; // 'FB', 'PRG', 'FUN', 'POU'
  allMethods: string[];
  methodSignatures: Record<string, MethodSignatureInfo>;
}

/**
 * Extracts comprehensive POU hierarchy metadata from .TcPOU XML content.
 */
export function extractPouHierarchyMetadata(
  pouXml: string,
  fileName: string = 'POU.TcPOU'
): PouHierarchyMetadata {
  const cleanFileName = fileName || 'POU.TcPOU';
  const defaultNameFromFileName = cleanFileName.replace(/\.[^/.]+$/, '').trim() || 'POU';

  if (!pouXml || !pouXml.trim()) {
    return {
      fileName: cleanFileName,
      pouName: defaultNameFromFileName,
      pouType: 'FUNCTION_BLOCK',
      pouTypeShort: 'FB',
      allMethods: ['doState()'],
      methodSignatures: {
        doState: { name: 'doState', isStateMethod: true, returnType: 'BOOL' },
      },
    };
  }

  // 1. Extract POU Name
  const pouMatch = pouXml.match(/<POU[^>]*\bName=["']([^"']+)["']/i);
  const pouName = pouMatch && pouMatch[1]?.trim() ? pouMatch[1].trim() : defaultNameFromFileName;

  // 2. Extract POU Type (FUNCTION_BLOCK, PROGRAM, or FUNCTION)
  let pouType: PouType = 'FUNCTION_BLOCK';
  let pouTypeShort = 'FB';

  const declMatch = pouXml.match(/<Declaration><!\[CDATA\[([\s\S]*?)\]\]><\/Declaration>/i);
  if (declMatch && declMatch[1]) {
    const declText = declMatch[1];
    if (/\bPROGRAM\b/i.test(declText)) {
      pouType = 'PROGRAM';
      pouTypeShort = 'PRG';
    } else if (/\bFUNCTION\s+[A-Za-z0-9_]+\s*:/i.test(declText)) {
      pouType = 'FUNCTION';
      pouTypeShort = 'FUN';
    } else if (/\bFUNCTION_BLOCK\b/i.test(declText)) {
      pouType = 'FUNCTION_BLOCK';
      pouTypeShort = 'FB';
    }
  }

  // 3. Extract all methods and their signatures
  const methodRegex = /<Method[^>]*\bName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Method>/gi;
  const methodsList: string[] = [];
  const signatures: Record<string, MethodSignatureInfo> = {};

  let mMatch: RegExpExecArray | null;
  while ((mMatch = methodRegex.exec(pouXml)) !== null) {
    const rawMethodName = mMatch[1].trim();
    if (!rawMethodName) continue;

    methodsList.push(rawMethodName);

    const methodBody = mMatch[2] || '';
    const mDeclMatch = methodBody.match(/<Declaration><!\[CDATA\[([\s\S]*?)\]\]><\/Declaration>/i);

    let returnType: string | undefined;
    let accessModifier: 'PUBLIC' | 'PRIVATE' | 'PROTECTED' | 'INTERNAL' | undefined;

    if (mDeclMatch && mDeclMatch[1]) {
      const mDeclText = mDeclMatch[1];
      // Check access modifier
      const modMatch = mDeclText.match(/\bMETHOD\s+(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\b/i);
      if (modMatch && modMatch[1]) {
        accessModifier = modMatch[1].toUpperCase() as any;
      }

      // Check return type: METHOD [MODIFIER] Name : ReturnType
      const retMatch = mDeclText.match(/\bMETHOD(?:\s+[A-Za-z]+)?\s+[A-Za-z0-9_]+\s*:\s*([A-Za-z0-9_]+)/i);
      if (retMatch && retMatch[1]) {
        returnType = retMatch[1].trim();
      }
    }

    const isStateMethod = rawMethodName.toLowerCase() === 'dostate';

    signatures[rawMethodName] = {
      name: rawMethodName,
      returnType,
      accessModifier,
      isStateMethod,
    };
  }

  // Ensure doState is present
  if (!methodsList.some((m) => m.toLowerCase() === 'dostate')) {
    methodsList.push('doState');
    signatures['doState'] = {
      name: 'doState',
      isStateMethod: true,
      returnType: 'BOOL',
    };
  }

  // Sort unique methods ascending
  const uniqueSorted = Array.from(new Set(methodsList)).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  return {
    fileName: cleanFileName,
    pouName,
    pouType,
    pouTypeShort,
    allMethods: uniqueSorted,
    methodSignatures: signatures,
  };
}
