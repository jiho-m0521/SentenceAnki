declare module "sql.js" {
  type SqlValue = string | number | Uint8Array | null;

  type QueryExecResult = {
    columns: string[];
    values: SqlValue[][];
  };

  class Database {
    constructor(data?: Uint8Array);
    exec(sql: string): QueryExecResult[];
    run(sql: string, params?: SqlValue[]): Database;
    export(): Uint8Array;
    close(): void;
  }

  type SqlJsStatic = {
    Database: typeof Database;
  };

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
