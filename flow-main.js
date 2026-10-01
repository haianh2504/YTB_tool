// Flow renders its composer inside closed Shadow DOM. Expose newly-created
// roots so the isolated content script can locate and operate the real UI.
const nativeAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function attachOpenShadow(init) {
  return nativeAttachShadow.call(this, { ...init, mode: "open" });
};
