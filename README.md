# Simple MySQL/MariaDB Pool Helper/Wrapper

```typescript
import MySQL from "@gibme/mysql";

(async () => {
    const client = new MySQL({
       host: 'localhost',
       port: 3306,
       user: 'someuser',
       password: 'somepassword',
       database: 'somedatabase' 
    });
    
    await client.createTable('test', 
        [{
            name: 'column1',
            type: 'varchar(255)'
        },{
            name: 'column2',
            type: 'float'
        }],
        ['column1']);
    
    await client.multiInsert('test',
        ['column1', 'column2'],
        [
            ['test', 10 ],
            ['some', 20 ],
            ['values', 30]
        ]);
    
    const [rows, meta] = await client.query<{
        column1: string,
        column2: number
    }>('SELECT * FROM test');
    
    console.log(meta, rows);
})()
```
