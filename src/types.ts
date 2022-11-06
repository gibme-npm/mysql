// Copyright (c) 2016-2022 Brandon Lehmann
//
// Please see the included LICENSE file for more information.

interface QueryMetaData {
    changedRows: number;
    affectedRows: number;
    insertId: number;
    length: number;
}

export type QueryResult<RecordType = any> = [RecordType[], QueryMetaData];

export interface Query {
    query: string;
    values?: any[];
}

export type ValueArray = any[][];

export enum ForeignKeyConstraint {
    RESTRICT = 'RESTRICT',
    CASCADE = 'CASCADE',
    NULL = 'SET NULL',
    DEFAULT = 'SET DEFAULT',
    NA = 'NO ACTION'
}

export interface ForeignKey {
    table: string;
    column: string;
    onUpdate?: ForeignKeyConstraint;
    onDelete?: ForeignKeyConstraint;
}

export interface Column {
    name: string;
    type: string;
    nullable?: boolean;
    foreignKey?: ForeignKey;
    unique?: boolean;
    default?: string | number | boolean;
}
