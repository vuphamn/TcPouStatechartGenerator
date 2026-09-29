/// <reference types="vite/client" />

/** Each edition's version, from its files at build time (vite.config.ts) */
declare const __KSS_VERSIONS__: { xae: string; desktop: string; web: string };
/** Link's code stamp (link/ and shared/ hashed) this page was built with */
declare const __KSS_LINK_STAMP__: string;

declare module 'virtual:kss-release-notes' {
  const history: import('./utils/releaseNotes.ts').ReleaseHistory;
  export default history;
}
