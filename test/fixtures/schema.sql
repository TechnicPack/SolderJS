CREATE TABLE modpacks (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL UNIQUE,
  slug varchar(255) NOT NULL UNIQUE,
  recommended varchar(255),
  latest varchar(255),
  hidden boolean NOT NULL DEFAULT true,
  private boolean NOT NULL DEFAULT false
);

CREATE TABLE builds (
  id serial PRIMARY KEY,
  modpack_id integer NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  version varchar(255) NOT NULL,
  minecraft varchar(255) NOT NULL DEFAULT '',
  forge varchar(255),
  is_published boolean NOT NULL DEFAULT false,
  private boolean NOT NULL DEFAULT false,
  min_java varchar(255),
  min_memory integer
);

CREATE TABLE mods (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL UNIQUE,
  pretty_name varchar(255) NOT NULL DEFAULT '',
  author varchar(255),
  description text,
  link varchar(255)
);

CREATE TABLE modversions (
  id serial PRIMARY KEY,
  mod_id integer NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  version varchar(255) NOT NULL,
  md5 varchar(255) NOT NULL,
  filesize integer
);

CREATE TABLE build_modversion (
  id serial PRIMARY KEY,
  build_id integer NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  modversion_id integer NOT NULL REFERENCES modversions(id) ON DELETE CASCADE
);

CREATE TABLE clients (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  uuid varchar(255) NOT NULL
);

CREATE TABLE client_modpack (
  id serial PRIMARY KEY,
  client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  modpack_id integer NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE
);

CREATE TABLE keys (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  api_key varchar(255) NOT NULL,
  created_at timestamp without time zone
);

CREATE INDEX builds_modpack_id_index ON builds(modpack_id);
CREATE INDEX build_modversion_build_id_index ON build_modversion(build_id);
CREATE INDEX client_modpack_client_id_index ON client_modpack(client_id);
CREATE INDEX clients_uuid_index ON clients(uuid);
CREATE INDEX keys_api_key_index ON keys(api_key);
