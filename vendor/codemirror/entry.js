// Einstiegspunkt für das CodeMirror-Bündel (vendor/codemirror.js). Neu bauen: siehe build.sh.
// Bewusst ohne @codemirror/lang-markdown (zieht HTML/CSS/JS-Parser mit); die Sprache wird in
// features/editor.js direkt aus @lezer/markdown gebaut.
export { EditorState, EditorSelection, StateField, StateEffect, RangeSetBuilder, Compartment, Prec } from '@codemirror/state';
export { EditorView, ViewPlugin, Decoration, WidgetType, keymap, drawSelection, placeholder } from '@codemirror/view';
export { history, defaultKeymap, historyKeymap, indentWithTab, indentMore, indentLess } from '@codemirror/commands';
export { Language, defineLanguageFacet, LanguageSupport, syntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
export { parser as markdownParser, GFM } from '@lezer/markdown';
export { tags } from '@lezer/highlight';
