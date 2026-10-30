// What a finger is doing on the document. A press held still draws a redaction, and from then on the
// finger must not scroll: the page tells the viewer so here, and the viewer's touchmove listener stops the scrolling.

export const touch = { drawing: false };
