/** Exercise the actual handlers: ownership, scoped history, read races and Gaffer handoff. */
const fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../.."),
  cache = new Map();
const mocks = new Map();
const registered = Object.fromEntries(
  [
    "query",
    "mutation",
    "internalQuery",
    "internalMutation",
    "internalAction",
    "action",
  ].map((k) => [k, (x) => x]),
);
const refs = new Proxy(
  {},
  { get: (_, g) => new Proxy({}, { get: (_, f) => `${g}.${f}` }) },
);
function load(file) {
  let filename = path.resolve(root, file);
  if (!fs.existsSync(filename) && filename.endsWith(".ts"))
    filename = filename.slice(0, -3) + ".js";
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  cache.set(filename, mod.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) =>
      mocks.has(name)
        ? mocks.get(name)
        : name.endsWith("_generated/server")
          ? registered
          : name.endsWith("_generated/api")
            ? { api: refs, internal: refs }
            : name.startsWith(".")
              ? load(
                  path.relative(
                    root,
                    path.resolve(path.dirname(filename), name + ".ts"),
                  ),
                )
              : require(name),
    mod,
    mod.exports,
  );
  cache.set(filename, mod.exports);
  return mod.exports;
}
let serial = 0;
const tables = new Map(),
  docs = new Map();
function put(table, data) {
  const row = {
    _id: data._id ?? `${table}-${++serial}`,
    _creationTime: ++serial,
    ...data,
  };
  docs.set(row._id, row);
  if (!tables.has(table)) tables.set(table, []);
  tables.get(table).push(row);
  return row;
}
const db = {
  get: async (id) => docs.get(id) ?? null,
  insert: async (table, data) => put(table, data)._id,
  patch: async (id, p) => Object.assign(docs.get(id), p),
  delete: async (id) => {
    docs.delete(id);
    for (const [t, rows] of tables)
      tables.set(
        t,
        rows.filter((r) => r._id !== id),
      );
  },
  query(table) {
    let rows = [...(tables.get(table) ?? [])],
      descending = false;
    const query = {
      withIndex(_, fn) {
        const q = {
          eq(k, v) {
            rows = rows.filter((r) => r[k] === v);
            return q;
          },
          gte(k, v) {
            rows = rows.filter((r) => r[k] >= v);
            return q;
          },
        };
        fn(q);
        return query;
      },
      filter(fn) {
        const q = { field: (k) => k, eq: (k, v) => (r) => r[k] === v };
        rows = rows.filter(fn(q));
        return query;
      },
      order(v) {
        descending = v === "desc";
        return query;
      },
      collect: async () => rows,
      first: async () => rows[0] ?? null,
      take: async (n) =>
        rows
          .sort(
            (a, b) =>
              (descending ? -1 : 1) *
              ((a.at ?? a._creationTime) - (b.at ?? b._creationTime)),
          )
          .slice(0, n),
      paginate: async ({ numItems, cursor }) => {
        const start = Number(cursor ?? 0);
        rows.sort((a, b) => (descending ? -1 : 1) * (a.at - b.at));
        return {
          page: rows.slice(start, start + numItems),
          isDone: start + numItems >= rows.length,
          continueCursor: String(start + numItems),
        };
      },
    };
    return query;
  },
};
module.exports = {
  load,
  db,
  put,
  tables,
  docs,
  setMock: (name, value) => mocks.set(name, value),
};
