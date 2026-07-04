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
    "/workspaces/{workspaceId}/knowledge/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List registered knowledge sources (the workspace's + the user's global sources). */
        get: operations["getWorkspacesByWorkspaceIdKnowledgeSources"];
        put?: never;
        /** Register a directory to index, at workspace or global scope. */
        post: operations["postWorkspacesByWorkspaceIdKnowledgeSources"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/knowledge/sources/{sourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a registered knowledge source (stops watching; purges its docs + chunks). */
        delete: operations["deleteWorkspacesByWorkspaceIdKnowledgeSourcesBySourceId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every pending approval for the user — the global queue, across all sessions/workspaces + the brain. */
        get: operations["getApprovalsPending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{providerApprovalId}/decide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve an approval — approve (optionally with edited input / a remembered rule) or deny with a reason. */
        post: operations["postApprovalsByProviderApprovalIdDecide"];
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
    getWorkspacesByWorkspaceIdKnowledgeSources: {
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
            /** @description { sources: SerializedKnowledgeSource[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        sources: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            /** @enum {string} */
                            scope: "workspace" | "global";
                            absolutePath: string;
                            createdAt: string;
                            updatedAt: string;
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
    postWorkspacesByWorkspaceIdKnowledgeSources: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    absolutePath: string;
                    /** @enum {string} */
                    scope: "workspace" | "global";
                };
            };
        };
        responses: {
            /** @description { source: SerializedKnowledgeSource, indexed: { indexedCount, skippedCount, failedCount } }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        source: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            /** @enum {string} */
                            scope: "workspace" | "global";
                            absolutePath: string;
                            createdAt: string;
                            updatedAt: string;
                        };
                        indexed: {
                            indexedCount: number;
                            skippedCount: number;
                            failedCount: number;
                        };
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
    deleteWorkspacesByWorkspaceIdKnowledgeSourcesBySourceId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sourceId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { removed: boolean }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        removed: boolean;
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
    getApprovalsPending: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pending approval requests, newest first (ApprovalRequestResponse[]). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postApprovalsByProviderApprovalIdDecide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                providerApprovalId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    kind: "approved";
                    updatedInput?: unknown;
                    rememberRule?: {
                        /** @constant */
                        kind: "auto-approve-action-kind";
                    } | {
                        /** @constant */
                        kind: "auto-approve-tool-name";
                    };
                } | {
                    /** @constant */
                    kind: "denied";
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Resolved; the paused agent is unblocked (ApprovalRequestResponse). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No pending approval with that id for this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The approval was already resolved. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
