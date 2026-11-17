"use strict";
// Narrow maintained AST surface; no ordinary-object conversion or alias expansion.
const {parseDocument,isScalar,isMap,isSeq,isAlias} = require("yaml");
module.exports = {parseDocument,isScalar,isMap,isSeq,isAlias};
