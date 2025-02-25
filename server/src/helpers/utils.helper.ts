import { QueryError } from 'src/modules/data_sources/query.errors';
import * as sanitizeHtml from 'sanitize-html';
import { EntityManager, getManager } from 'typeorm';
import { isEmpty } from 'lodash';
import { ConflictException } from '@nestjs/common';
import { DataBaseConstraints } from './db_constraints.constants';
const protobuf = require('protobufjs');
const semver = require('semver');

export function maybeSetSubPath(path) {
  const hasSubPath = process.env.SUB_PATH !== undefined;
  const urlPrefix = hasSubPath ? process.env.SUB_PATH : '';

  if (isEmpty(urlPrefix)) {
    return path;
  }

  const pathWithoutLeadingSlash = path.replace(/^\/+/, '');
  return urlPrefix + pathWithoutLeadingSlash;
}

export function parseJson(jsonString: string, errorMessage?: string): object {
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    throw new QueryError(errorMessage, err.message, {});
  }
}

export async function cacheConnection(dataSourceId: string, connection: any): Promise<any> {
  const updatedAt = new Date();
  globalThis.CACHED_CONNECTIONS[dataSourceId] = { connection, updatedAt };
}

export async function getCachedConnection(dataSourceId, dataSourceUpdatedAt): Promise<any> {
  const cachedData = globalThis.CACHED_CONNECTIONS[dataSourceId] || {};

  if (cachedData) {
    const updatedAt = new Date(dataSourceUpdatedAt || null);
    const cachedAt = new Date(cachedData.updatedAt || null);

    const diffTime = (cachedAt.getTime() - updatedAt.getTime()) / 1000;

    if (diffTime < 0) {
      return null;
    } else {
      return cachedData['connection'];
    }
  }
}

export function cleanObject(obj: any): any {
  // This will remove undefined properties, for self and its children
  Object.keys(obj).forEach((key) => {
    obj[key] === undefined && delete obj[key];
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      cleanObject(obj[key]);
    }
  });
}

export function sanitizeInput(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'recursiveEscape',
  });
}

export function lowercaseString(value: string) {
  return value?.toLowerCase()?.trim();
}

export async function dbTransactionWrap(operation: (...args) => any, manager?: EntityManager): Promise<any> {
  if (manager) {
    return await operation(manager);
  } else {
    return await getManager().transaction(async (manager) => {
      return await operation(manager);
    });
  }
}

export const updateTimestampForAppVersion = async (manager, appVersionId) => {
  const appVersion = await manager.findOne('app_versions', appVersionId);
  if (appVersion) {
    await manager.update('app_versions', appVersionId, { updatedAt: new Date() });
  }
};

export async function dbTransactionForAppVersionAssociationsUpdate(
  operation: (...args) => any,
  appVersionId: string
): Promise<any> {
  return await getManager().transaction(async (manager) => {
    const result = await operation(manager);

    await updateTimestampForAppVersion(manager, appVersionId);

    return result;
  });
}

type DbContraintAndMsg = {
  dbConstraint: DataBaseConstraints;
  message: string;
};

export async function catchDbException(operation: () => any, dbConstraints: DbContraintAndMsg[]): Promise<any> {
  try {
    return await operation();
  } catch (err) {
    dbConstraints.map((dbConstraint) => {
      if (err?.message?.includes(dbConstraint.dbConstraint)) {
        throw new ConflictException(dbConstraint.message);
      }
    });

    throw err;
  }
}

export const defaultAppEnvironments = [{ name: 'production', isDefault: true, priority: 3 }];

export function isPlural(data: Array<any>) {
  return data?.length > 1 ? 's' : '';
}

export function validateDefaultValue(value: any, params: any) {
  const { data_type } = params;
  if (data_type === 'boolean') return value || 'false';
  return value;
}

export async function dropForeignKey(tableName: string, columnName: string, queryRunner) {
  const table = await queryRunner.getTable(tableName);
  const foreignKey = table.foreignKeys.find((fk) => fk.columnNames.indexOf(columnName) !== -1);
  await queryRunner.dropForeignKey(tableName, foreignKey);
}

export async function getServiceAndRpcNames(protoDefinition) {
  const root = protobuf.parse(protoDefinition).root;
  const serviceNamesAndMethods = root.nestedArray
    .filter((item) => item instanceof protobuf.Service)
    .reduce((acc, service) => {
      const rpcMethods = service.methodsArray.map((method) => method.name);
      acc[service.name] = rpcMethods;
      return acc;
    }, {});
  return serviceNamesAndMethods;
}

export class MigrationProgress {
  private progress = 0;
  constructor(private fileName: string, private totalCount: number) {}

  show() {
    this.progress++;
    console.log(`${this.fileName} Progress ${Math.round((this.progress / this.totalCount) * 100)} %`);
  }
}

export const processDataInBatches = async <T>(
  entityManager: EntityManager,
  getData: (entityManager: EntityManager, skip: number, take: number) => Promise<T[]>,
  processBatch: (entityManager: EntityManager, data: T[]) => Promise<void>,
  batchSize = 1000
): Promise<void> => {
  let skip = 0;
  let data: T[];

  do {
    data = await getData(entityManager, skip, batchSize);
    skip += batchSize;

    if (data.length > 0) {
      await processBatch(entityManager, data);
    }
  } while (data.length === batchSize);
};

export const generateNextNameAndSlug = (firstWord: string) => {
  const name = `${firstWord} ${Date.now()}`;
  const slug = name.replace(/\s+/g, '-').toLowerCase();
  return {
    name,
    slug,
  };
};

export const truncateAndReplace = (name) => {
  const secondsSinceEpoch = Date.now();
  if (name.length > 35) {
    return name.replace(name.substring(35, 50), secondsSinceEpoch);
  }
  return name + secondsSinceEpoch;
};

export const generateInviteURL = (
  invitationToken: string,
  organizationToken?: string,
  organizationId?: string,
  source?: string
) => {
  const host = process.env.TOOLJET_HOST;
  const subpath = process.env.SUB_PATH;

  return `${host}${subpath ? subpath : '/'}invitations/${invitationToken}${
    organizationToken ? `/workspaces/${organizationToken}${organizationId ? `?oid=${organizationId}` : ''}` : ''
  }${source ? `${organizationId ? '&' : '?'}source=${source}` : ''}`;
};

export const generateOrgInviteURL = (organizationToken: string, organizationId?: string) => {
  const host = process.env.TOOLJET_HOST;
  const subpath = process.env.SUB_PATH;
  return `${host}${subpath ? subpath : '/'}organization-invitations/${organizationToken}${
    organizationId ? `?oid=${organizationId}` : ''
  }`;
};

export function extractMajorVersion(version) {
  return semver.valid(semver.coerce(version));
}

export function checkVersionCompatibility(importingVersion) {
  return semver.gte(semver.coerce(globalThis.TOOLJET_VERSION), semver.coerce(importingVersion));
}

/**
 * Checks if a given Tooljet version is compatible with normalized app definition schemas.
 *
 * This function uses the 'semver' library to compare the provided version with a minimum version requirement
 * for normalized app definition schemas (2.24.1). It returns true if the version is greater than or equal to
 * the required version, indicating compatibility.
 *
 * @param {string} version - The Tooljet version to check.
 * @returns {boolean} - True if the version is compatible, false otherwise.
 */
export function isTooljetVersionWithNormalizedAppDefinitionSchem(version) {
  return semver.satisfies(semver.coerce(version), '>= 2.24.0');
}

export function isVersionGreaterThanOrEqual(version1: string, version2: string) {
  if (!version1) return false;

  const v1Parts = version1.split('-')[0].split('.').map(Number);
  const v2Parts = version2.split('-')[0].split('.').map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = +v1Parts[i] || 0;
    const v2Part = +v2Parts[i] || 0;

    if (v1Part < v2Part) {
      return false;
    } else if (v1Part > v2Part) {
      return true;
    }
  }

  return true;
}

export const getMaxCopyNumber = (existNameList, splitChar = '_') => {
  if (existNameList.length == 0) return '';
  const filteredNames = existNameList.filter((name) => {
    const parts = name.split(splitChar);
    return !isNaN(parseInt(parts[parts.length - 1]));
  });

  // Extracting numbers from the filtered names
  const numbers = filteredNames.map((name) => {
    const parts = name.split(splitChar);
    return parseInt(parts[parts.length - 1]);
  });

  // Finding the maximum number
  // Creating the new name with maxNumber + 1
  const maxNumber = Math.max(...numbers, 0);
  return maxNumber + 1;
};
