const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function files(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "_generated" || entry.name === "node_modules") return [];
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return files(name);
    return /\.(ts|tsx)$/.test(name) ? [name] : [];
  });
}

function inventory() {
  const entries = new Set();
  for (const filename of [...files("convex"), ...files("src")]) {
    const source = ts.createSourceFile(filename, fs.readFileSync(path.join(root, filename), "utf8"), ts.ScriptTarget.Latest, true,
      filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const apiNames = new Set();
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.includes("_generated/api")) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
          if ((specifier.propertyName ?? specifier.name).text === "api") apiNames.add(specifier.name.text);
        }
      }
      if (!filename.startsWith("convex/") && !/^src\/app\/api\/.*\/route\.ts$/.test(filename)) continue;
      if (ts.isExportDeclaration(statement)) {
        entries.add(`export ${filename}:${statement.getText(source)}`);
      } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          entries.add(`export ${filename}:${declaration.name.getText(source)}`);
        } else if (statement.name) entries.add(`export ${filename}:${statement.name.getText(source)}`);
      }
    }
    if (/^src\/app\/api\/.*\/route\.ts$/.test(filename)) entries.add(`route ${filename}`);
    function visit(node) {
      if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
        let current = node;
        const parts = [];
        while (ts.isPropertyAccessExpression(current)) {
          parts.unshift(current.name.text);
          current = current.expression;
        }
        if (ts.isIdentifier(current) && apiNames.has(current.text)) entries.add(`call ${filename}:${parts.join(".")}`);
      }
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && apiNames.has(node.expression.text))
        entries.add(`dynamic ${filename}:${node.getText(source)}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...entries].sort();
}

if (require.main === module) process.stdout.write(`${inventory().join("\n")}\n`);
module.exports = { inventory };
