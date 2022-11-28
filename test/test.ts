// Copyright (c) 2016-2022, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import assert from 'assert';
import { describe, it } from 'mocha';
import MySQL, { escapeId } from '../src/mysql';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config();

const digest = (value: string): string => {
    return createHash('sha512')
        .update(value)
        .digest()
        .toString('hex')
        .substring(0, 10);
};

const test_table = digest(process.env.MYSQL_TABLE || 'test');
const second_table = digest(test_table);

describe('Unit Tests', () => {
    const mysql = new MySQL({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        user: process.env.MYSQL_USER || '',
        password: process.env.MYSQL_PASSWORD || undefined,
        database: process.env.MYSQL_DATABASE || undefined,
        connectTimeout: 30_000
    });

    const values: any[][] = [];

    for (let i = 0; i < 100; i++) {
        values.push([`test${i}`, i]);
    }

    before(async () => {
        await mysql.dropTable(test_table);
    });

    after(async () => {
        await mysql.dropTable(test_table);

        await mysql.close();
    });

    describe('Basic Tests', () => {
        it('Version', async () => {
            const [rows] = await mysql.query<{version: string}>('SELECT VERSION() as version');

            assert(rows.length !== 0);
        });
    });

    describe('Tables', () => {
        it(`Create ${test_table}`, async () => {
            return mysql.createTable(test_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)'
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ], ['column1']);
        });

        it('List', async () => {
            const tables = await mysql.listTables();

            assert(tables.includes(test_table));
        });

        it(`Drop ${second_table}`, async () => {
            await mysql.createTable(second_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)'
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ], ['column1']);

            {
                const tables = await mysql.listTables();

                assert(tables.includes(second_table));
            }

            await mysql.dropTable(second_table);

            {
                const tables = await mysql.listTables();

                assert(!tables.includes(second_table));
            }
        });
    });

    describe('Bulk Insert / Updates', () => {
        it('Bulk Insert', async () => {
            return mysql.multiInsert(
                test_table,
                ['column1', 'column2'],
                values);
        });

        it('Bulk Update', async () => {
            return mysql.multiUpdate(
                test_table,
                ['column1'],
                ['column1', 'column2'],
                values.map(row => {
                    row[1]++;

                    return row;
                }));
        });
    });

    describe('Queries', () => {
        it('Select', async () => {
            const [rows] = await mysql.query<{ column1: string, column2: number }>(
                `SELECT * FROM ${escapeId(test_table)} WHERE ${escapeId('column1')} = ?`,
                [values[0][0]]
            );

            assert(rows[0].column2 === 1);
        });

        it('Delete', async () => {
            const [, meta] = await mysql.query(
                `DELETE FROM ${escapeId(test_table)} WHERE ${escapeId('column1')} = ?`,
                [values[0][0]]
            );

            assert(meta.affectedRows === 1);
        });

        it('Update', async () => {
            await mysql.query(
                `UPDATE ${escapeId(test_table)} SET ${escapeId('column2')} = ? WHERE ${escapeId('column1')} = ?`,
                [5, values[1][0]]
            );

            const [rows] = await mysql.query<{ column1: string, column2: number }>(
                `SELECT * FROM ${escapeId(test_table)} WHERE ${escapeId('column1')} = ?`,
                [values[1][0]]
            );

            assert(rows[0].column2 === 5);
        });
    });
});
