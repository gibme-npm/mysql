// Copyright (c) 2016-2022 Brandon Lehmann
//
// Please see the included LICENSE file for more information.

import { createPool, escape, Pool, PoolConfig, PoolConnection } from 'mysql';
import { EventEmitter } from 'events';
import { Column, ForeignKey, ForeignKeyConstraint, Query, QueryResult, ValueArray } from './types';
import { format } from 'util';

export { ForeignKey, ForeignKeyConstraint, Column, Query, ValueArray, PoolConfig };

export default class MySQL extends EventEmitter {
    public readonly pool: Pool;
    public tableOptions = 'ENGINE=InnoDB PACK_KEYS=1 ROW_FORMAT=COMPRESSED';

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (public readonly config: PoolConfig) {
        super();

        config.ssl ||= {
            rejectUnauthorized: true
        };

        this.pool = createPool(config);

        this.pool.on('error', error => this.emit('error', error));
        this.pool.on('acquire', connection => this.emit('acquire', connection));
        this.pool.on('connection', connection => this.emit('connection', connection));
        this.pool.on('enqueue', () => this.emit('enqueue'));
        this.pool.on('release', connection => this.emit('release', connection));
    }

    public on(event: 'error', listener: (error: Error) => void): this;

    public on(event: 'acquire', listener: (connection: PoolConnection) => void): this;

    public on(event: 'connection', listener: (connection: PoolConnection) => void): this;

    public on(event: 'enqueue', listener: () => void): this;

    public on(event: 'release', listener: (connection: PoolConnection) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Closes all the pooled connections
     */
    public async close (): Promise<void> {
        return new Promise((resolve, reject) => {
            this.pool.end(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Prepares and executes the creation of a table including the relevant indexes and
     * constraints
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     * @param useTransaction
     */
    public async createTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions = this.tableOptions,
        useTransaction = true
    ): Promise<void> {
        const queries = this.prepareCreateTable(name, fields, primaryKey, tableOptions);

        if (useTransaction) {
            await this.transaction(queries);
        } else {
            for (const query of queries) {
                await this.query(query);
            }
        }
    }

    /**
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     * @param connection
     */
    public async query<RecordType = any> (
        query: string | Query,
        values: any[] = [],
        connection: Pool | PoolConnection = this.pool
    ): Promise<QueryResult<RecordType>> {
        return new Promise((resolve, reject) => {
            if (typeof query === 'object') {
                if (query.values) {
                    values = query.values;
                }

                query = query.query;
            }

            connection.query(query, values, (error, results) => {
                if (error) {
                    return reject(error);
                }

                return resolve([results, {
                    changedRows: results.changedRows || 0,
                    affectedRows: results.affectedRows || 0,
                    insertId: results.insertId || 0,
                    length: results.length
                }]);
            });
        });
    }

    /**
     * Prepares and performs a query that performs a multi-insert statement
     * which is far faster than a bunch of individual insert statements
     *
     * @param table
     * @param columns
     * @param values
     * @param useTransaction
     */
    public async multiInsert (
        table: string,
        columns: string[],
        values: ValueArray,
        useTransaction = true
    ): Promise<QueryResult> {
        const query = this.prepareMultiInsert(table, columns, values);

        if (useTransaction) {
            return (await this.transaction([query]))[0];
        } else {
            return this.query(query);
        }
    }

    /**
     * Prepares and executes a query to that performs  a multi-update statement
     * which is based upon a multi-insert statement that performs an UPSERT
     * which is a lot faster than a bunch of update statements
     *
     * @param table
     * @param primaryKey
     * @param columns
     * @param values
     * @param useTransaction
     */
    public async multiUpdate (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: ValueArray,
        useTransaction = true
    ): Promise<QueryResult> {
        const query = this.prepareMultiUpdate(table, primaryKey, columns, values);

        if (useTransaction) {
            return (await this.transaction([query]))[0];
        } else {
            return this.query(query);
        }
    }

    /**
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        const connection = await this.connection();

        try {
            await this.beginTransaction(connection);

            const results: QueryResult<RecordType>[] = [];

            for (const query of queries) {
                results.push(await this.query(query.query, query.values, connection));
            }

            await this.commitTransaction(connection);

            return results;
        } catch (error: any) {
            await this.rollbackTransaction(connection);

            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Prepares a query to perform a multi-insert statement which is far
     * faster than a bunch of individual insert statements
     *
     * @param table
     * @param columns
     * @param values
     */
    public prepareMultiInsert (
        table: string,
        columns: string[],
        values: ValueArray
    ): Query {
        const query = `INSERT INTO ${table} (${columns.join(',')}) VALUES %L`;

        return {
            query: query.replace('%L', escape(values))
        };
    }

    /**
     * Prepares a query to perform a multi-update statement which is
     * based upon a multi-insert statement that performs an UPSERT
     * and this is a lot faster than a bunch of individual
     * update statements
     *
     * @param table
     * @param primaryKey
     * @param columns
     * @param values
     */
    public prepareMultiUpdate (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: ValueArray
    ): Query {
        const query = this.prepareMultiInsert(table, columns, values);

        const updates: string[] = [];

        for (const column of columns) {
            if (primaryKey.includes(column)) {
                continue;
            }

            updates.push(` ${column} = VALUES(${column})`);
        }

        query.query += ` ON DUPLICATE KEY UPDATE ${updates.join(',')}`;

        return query;
    }

    /**
     * Prepares the creation of a table including the relevant indexes and
     * constraints
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     */
    public prepareCreateTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions = this.tableOptions
    ): Query[] {
        const sqlToQuery = (sql: string, values: any[] = []): Query => {
            return {
                query: sql,
                values
            };
        };

        const values: any[] = [];

        const _fields = fields.map(column => {
            if (column.default) {
                values.push(column.default);
            }

            return format('%s %s %s %s',
                column.name,
                column.type.toUpperCase(),
                !column.nullable ? 'NOT NULL' : 'NULL',
                column.default ? 'DEFAULT ?' : '')
                .trim();
        });

        const _unique = fields.filter(elem => elem.unique === true)
            .map(column => format('CREATE UNIQUE INDEX IF NOT EXISTS %s_unique_%s ON %s (%s)',
                name,
                column.name,
                name,
                column.name)
                .trim());

        const constraint_fmt = ', CONSTRAINT %s_%s_foreign_key FOREIGN KEY (%s) REFERENCES %s (%s)';

        const _constraints: string[] = [];

        for (const field of fields) {
            if (field.foreignKey) {
                let constraint = format(constraint_fmt,
                    name,
                    field.name,
                    field.name,
                    field.foreignKey.table,
                    field.foreignKey.column);

                if (field.foreignKey.onDelete) {
                    constraint += format(' ON DELETE %s', field.foreignKey.onDelete);
                }

                if (field.foreignKey.onUpdate) {
                    constraint += format(' ON UPDATE %s', field.foreignKey.onUpdate);
                }

                _constraints.push(constraint.trim());
            }
        }

        const sql = format('CREATE TABLE IF NOT EXISTS %s (%s, PRIMARY KEY (%s)%s) %s;',
            name,
            _fields.join(','),
            primaryKey.join(','),
            _constraints.join(','),
            tableOptions);

        return [sqlToQuery(sql, values), ..._unique.map(sql => sqlToQuery(sql))];
    }

    /**
     * Returns a database connection from the pool
     *
     * @protected
     */
    protected async connection (): Promise<PoolConnection> {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((error, connection) => {
                if (error) {
                    return reject(error);
                }

                return resolve(connection);
            });
        });
    }

    /**
     * Starts a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async beginTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.beginTransaction(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Commits a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async commitTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.commit(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Rolls back a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async rollbackTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.rollback(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }
}
