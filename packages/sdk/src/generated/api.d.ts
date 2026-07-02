export interface paths {
    "/workspaces/{workspaceId}/knowledge/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List indexed documents for the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdKnowledgeDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/knowledge/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one knowledge document + its chunks (workspace-scoped). */
        get: operations["getWorkspacesByWorkspaceIdKnowledgeDocumentsByDocumentId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/knowledge/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search knowledge chunks (FTS5, semantic, or hybrid). */
        get: operations["getWorkspacesByWorkspaceIdKnowledgeSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/knowledge/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the indexer status for the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdKnowledgeStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/knowledge/reindex": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Force-reindex every document in the active workspace. */
        post: operations["postWorkspacesByWorkspaceIdKnowledgeReindex"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getWorkspacesByWorkspaceIdKnowledgeDocuments: {
        parameters: {
            query?: {
                documentKind?: "markdown" | "plain-text" | "pdf" | "docx" | "html" | "csv" | "json" | "unsupported";
                cursorIndexedAt?: string | null;
                cursorId?: string;
                limit?: number;
                path?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { documents: SerializedKnowledgeDocument[], nextCursor }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        documents: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            relativePath: string;
                            /** @enum {string} */
                            documentKind: "markdown" | "plain-text" | "pdf" | "docx" | "html" | "csv" | "json" | "unsupported";
                            contentHash: string;
                            fileSizeBytes: number;
                            fileModifiedAt: string;
                            chunkCount: number;
                            /** @enum {string} */
                            parseStatus: "pending" | "parsing" | "parsed" | "failed" | "skipped";
                            parseErrorMessage: string | null;
                            indexedAt: string | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                        nextCursor: {
                            indexedAt: string | null;
                            id: string;
                        } | null;
                    };
                };
            };
            /** @description Workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdKnowledgeDocumentsByDocumentId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { document: SerializedKnowledgeDocument, chunks: SerializedKnowledgeChunk[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        document: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            relativePath: string;
                            /** @enum {string} */
                            documentKind: "markdown" | "plain-text" | "pdf" | "docx" | "html" | "csv" | "json" | "unsupported";
                            contentHash: string;
                            fileSizeBytes: number;
                            fileModifiedAt: string;
                            chunkCount: number;
                            /** @enum {string} */
                            parseStatus: "pending" | "parsing" | "parsed" | "failed" | "skipped";
                            parseErrorMessage: string | null;
                            indexedAt: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                        chunks: {
                            id: string;
                            documentId: string;
                            workspaceId: string;
                            chunkIndex: number;
                            startCharOffset: number;
                            endCharOffset: number;
                            chunkText: string;
                            chunkTokenEstimate: number;
                            embeddingPresent: boolean;
                            embeddingModelVersion: string | null;
                            createdAt: string;
                        }[];
                    };
                };
            };
            /** @description Knowledge document not found in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdKnowledgeSearch: {
        parameters: {
            query: {
                query: string;
                mode?: "fts" | "semantic" | "hybrid";
                limit?: number;
                documentKindFilter?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { results: SerializedKnowledgeSearchResult[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        results: {
                            chunkId: string;
                            documentId: string;
                            relativePath: string;
                            /** @enum {string} */
                            documentKind: "markdown" | "plain-text" | "pdf" | "docx" | "html" | "csv" | "json" | "unsupported";
                            chunkIndex: number;
                            chunkText: string;
                            ftsScore: number | null;
                            semanticScore: number | null;
                            combinedScore: number;
                        }[];
                    };
                };
            };
            /** @description Workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdKnowledgeStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SerializedIndexerStatus. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        workspaceId: string;
                        totalDocuments: number;
                        parsedDocuments: number;
                        pendingDocuments: number;
                        parsingDocuments: number;
                        failedDocuments: number;
                        skippedDocuments: number;
                        unindexedChunks: number;
                        lastIndexedAt: string | null;
                    };
                };
            };
            /** @description Workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdKnowledgeReindex: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { indexedCount, skippedCount, failedCount }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        indexedCount: number;
                        skippedCount: number;
                        failedCount: number;
                    };
                };
            };
            /** @description Workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
