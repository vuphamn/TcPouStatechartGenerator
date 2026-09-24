import React from 'react';
import { MethodStructuredTextEditor, MethodStructuredTextEditorProps } from './MethodStructuredTextEditor.tsx';

export interface PreProcessStructuredTextEditorProps {
  tcPouContent?: string;
  tcPouFileName?: string;
  onSavePreProcessCode?: (newCode: string, newDeclaration?: string) => { success: boolean; error?: string };
  onClose?: () => void;
  isModal?: boolean;
  onJumpToState?: (stateId: string) => void;
}

export const PreProcessStructuredTextEditor: React.FC<PreProcessStructuredTextEditorProps> = (props) => {
  return <MethodStructuredTextEditor {...props} initialMethod="preProcess" />;
};
