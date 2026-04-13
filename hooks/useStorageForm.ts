import { useState, useCallback } from "react";
import { S3Config, WebDAVConfig, StorageType } from "../types";
import {
  getS3Config,
  saveS3Config,
  DEFAULT_S3_CONFIG,
  getWebDAVConfig,
  saveWebDAVConfig,
  DEFAULT_WEBDAV_CONFIG,
  getStorageType,
  saveStorageType,
  testWebDAVConnection,
  testS3Connection,
  clearOPFS,
} from "../services/storageService";

/**
 * Manages storage-related form state for the settings dialog.
 * Handles S3/WebDAV configuration, connection testing, and data clearing.
 */
export const useStorageForm = () => {
  const [storageType, setStorageType] = useState<StorageType>("opfs");
  const [s3Config, setS3Config] = useState<S3Config>(DEFAULT_S3_CONFIG);
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>(
    DEFAULT_WEBDAV_CONFIG,
  );

  // Testing state
  const [testWebDAVResult, setTestWebDAVResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingWebDAV, setIsTestingWebDAV] = useState(false);
  const [testS3Result, setTestS3Result] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingS3, setIsTestingS3] = useState(false);

  const initializeStorage = useCallback(() => {
    setStorageType(getStorageType());
    setS3Config(getS3Config());
    setWebdavConfig(getWebDAVConfig());
    setTestWebDAVResult(null);
    setTestS3Result(null);
  }, []);

  const handleTestS3 = async () => {
    setIsTestingS3(true);
    setTestS3Result(null);
    try {
      const result = await testS3Connection(s3Config);
      setTestS3Result(result);
    } catch {
      setTestS3Result({ success: false, message: "Test failed" });
    } finally {
      setIsTestingS3(false);
    }
  };

  const handleTestWebDAV = async () => {
    if (
      window.location.protocol === "https:" &&
      webdavConfig.url.startsWith("http:")
    ) {
      setTestWebDAVResult({ success: false, message: "Mixed Content Error" });
      return;
    }
    setIsTestingWebDAV(true);
    setTestWebDAVResult(null);
    try {
      const result = await testWebDAVConnection(webdavConfig);
      setTestWebDAVResult(result);
    } catch {
      setTestWebDAVResult({ success: false, message: "Test failed" });
    } finally {
      setIsTestingWebDAV(false);
    }
  };

  const handleClearData = async () => {
    const errors: string[] = [];

    try {
      localStorage.clear();
    } catch (e) {
      errors.push("localStorage");
      console.error("Failed to clear localStorage", e);
    }

    try {
      sessionStorage.clear();
    } catch (e) {
      errors.push("sessionStorage");
      console.error("Failed to clear sessionStorage", e);
    }

    try {
      await clearOPFS();
    } catch (e) {
      errors.push("OPFS");
      console.error("Failed to clear OPFS", e);
    }

    try {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases.map((db) => {
          if (db.name) {
            return new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
            });
          }
          return Promise.resolve();
        }),
      );
    } catch (e) {
      errors.push("indexedDB");
      console.error("Failed to clear indexedDB", e);
    }

    if (errors.length > 0) {
      console.warn(`Data clearing had partial failures: ${errors.join(", ")}`);
    }

    window.location.reload();
  };

  const saveStorage = () => {
    saveStorageType(storageType);
    saveS3Config(s3Config);
    saveWebDAVConfig(webdavConfig);
  };

  return {
    storageType,
    setStorageType,
    s3Config,
    setS3Config,
    webdavConfig,
    setWebdavConfig,
    testS3Result,
    isTestingS3,
    handleTestS3,
    testWebDAVResult,
    isTestingWebDAV,
    handleTestWebDAV,
    handleClearData,
    initializeStorage,
    saveStorage,
  };
};
