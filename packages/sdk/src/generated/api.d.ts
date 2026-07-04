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
    "/workspaces/{workspaceId}/skills/available": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the Verified-skill catalog (available to install). */
        get: operations["getWorkspacesByWorkspaceIdSkillsAvailable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/installed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List skills installed in this user+workspace context. */
        get: operations["getWorkspacesByWorkspaceIdSkillsInstalled"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Install a Verified skill at user or workspace scope. */
        post: operations["postWorkspacesByWorkspaceIdSkillsInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/installed/{installedSkillId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Uninstall a skill (hard-delete + cascade per D13). */
        delete: operations["deleteWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/installed/{installedSkillId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable an installed skill — rewrites files from current settings. */
        post: operations["postWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/installed/{installedSkillId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable an installed skill — removes files from disk; preserves row + settings. */
        post: operations["postWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdDisable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update settings on an installed skill — re-renders SKILL.md if enabled. */
        patch: operations["patchWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdSettings"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/skills/synchronize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reconcile installed skills with what the provider sees on disk. */
        post: operations["postWorkspacesByWorkspaceIdSkillsSynchronize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List connected channels for the workspace (owner-scoped; credentials excluded). */
        get: operations["getWorkspacesByWorkspaceIdChannels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Connect a bot to the workspace (verifies the token before persisting). */
        post: operations["postWorkspacesByWorkspaceIdChannelsConnect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Disconnect a channel — hard-deletes it and cascades inbound/queue/allowlist rows. */
        delete: operations["deleteWorkspacesByWorkspaceIdChannelsByChannelId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a channel (resume polling). */
        post: operations["postWorkspacesByWorkspaceIdChannelsByChannelIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a channel (pause polling). */
        post: operations["postWorkspacesByWorkspaceIdChannelsByChannelIdDisable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}/allowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the allowed senders (allowlist) for a channel (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-senders"];
        put?: never;
        /** Add an allowed sender to a channel. */
        post: operations["postWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-senders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an allowed sender from a channel. */
        delete: operations["deleteWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-sendersBySenderLinkId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/channels/{channelId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a channel’s inbound message history (keyset cursor-paginated). */
        get: operations["getWorkspacesByWorkspaceIdChannelsByChannelIdHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List schedules for the active workspace (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdSchedules"];
        put?: never;
        /** Create a schedule (from a template or custom). */
        post: operations["postWorkspacesByWorkspaceIdSchedules"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the available schedule templates. */
        get: operations["getWorkspacesByWorkspaceIdSchedulesTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules/{scheduleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a schedule (hard delete; cascades to its run history). */
        delete: operations["deleteWorkspacesByWorkspaceIdSchedulesByScheduleId"];
        options?: never;
        head?: never;
        /** Update a schedule. */
        patch: operations["patchWorkspacesByWorkspaceIdSchedulesByScheduleId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules/{scheduleId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a schedule. */
        post: operations["postWorkspacesByWorkspaceIdSchedulesByScheduleIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules/{scheduleId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a schedule. */
        post: operations["postWorkspacesByWorkspaceIdSchedulesByScheduleIdDisable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/schedules/{scheduleId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a schedule’s run history (owner-scoped, newest first, keyset-paginated). */
        get: operations["getWorkspacesByWorkspaceIdSchedulesByScheduleIdRuns"];
        put?: never;
        post?: never;
        delete?: never;
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
    getWorkspacesByWorkspaceIdSkillsAvailable: {
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
            /** @description Array of catalog entries (definitions only). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdSkillsInstalled: {
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
            /** @description Each installed skill joined with its catalog definition (if any) + resolved settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    postWorkspacesByWorkspaceIdSkillsInstall: {
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
                    skillId: string;
                    /** @enum {string} */
                    scope: "user" | "workspace";
                    initialSettings?: {
                        [key: string]: string | number | boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The installed-skill row. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid initial settings. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Skill or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Already installed at the requested scope. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installedSkillId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uninstalled. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Skill is system-installed; uninstall blocked. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Installed-skill row not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installedSkillId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The updated installed-skill row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Installed-skill row not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdDisable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installedSkillId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The updated installed-skill row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Installed-skill row not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchWorkspacesByWorkspaceIdSkillsInstalledByInstalledSkillIdSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installedSkillId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    newSettings: {
                        [key: string]: string | number | boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The resolved settings (defaults merged with overrides). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid setting key or value. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Installed-skill row not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdSkillsSynchronize: {
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
            /** @description { healthyCount, missingOnDiskCount, externalDiscoveredCount }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdChannels: {
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
            /** @description Array of Channel (without bot credentials). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    postWorkspacesByWorkspaceIdChannelsConnect: {
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
                    /** @enum {string} */
                    channelKind: "telegram" | "discord";
                    displayName: string;
                    botCredentials: {
                        [key: string]: string;
                    };
                    initialAllowedSenderId?: string;
                };
            };
        };
        responses: {
            /** @description Channel connected (credentials excluded). */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bot token invalid or unsupported channel kind. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    deleteWorkspacesByWorkspaceIdChannelsByChannelId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Channel disconnected. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdChannelsByChannelIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated Channel. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdChannelsByChannelIdDisable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated Channel. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ChannelUserLink. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    externalSenderId: string;
                    externalSenderHandle?: string;
                    externalSenderDisplayName?: string;
                    scopeContextId?: string;
                };
            };
        };
        responses: {
            /** @description ChannelUserLink. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteWorkspacesByWorkspaceIdChannelsByChannelIdAllowed-sendersBySenderLinkId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                senderLinkId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sender removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdChannelsByChannelIdHistory: {
        parameters: {
            query?: {
                limit?: number;
                cursorReceivedAt?: number;
                cursorId?: string;
            };
            header?: never;
            path: {
                channelId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ChannelInboundMessage (newest first). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such channel in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdSchedules: {
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
            /** @description Array of Schedule. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    postWorkspacesByWorkspaceIdSchedules: {
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
                    /** @enum {string} */
                    templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                    displayName?: string;
                    cronExpression?: string;
                    timezone?: string;
                    promptTemplate?: string;
                    /** @enum {string} */
                    destinationKind?: "chat-only" | "chat-and-channel";
                    channelId?: string;
                    catchUpOnMiss?: boolean;
                    approvalTimeoutMsOverride?: number;
                    /** Format: date-time */
                    fireAt?: string;
                };
            };
        };
        responses: {
            /** @description Schedule created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid cron or missing channel. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdSchedulesTemplates: {
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
            /** @description Array of ScheduleTemplateDefinition. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteWorkspacesByWorkspaceIdSchedulesByScheduleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Schedule deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchWorkspacesByWorkspaceIdSchedulesByScheduleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    displayName?: string;
                    cronExpression?: string;
                    timezone?: string;
                    promptTemplate?: string;
                    /** @enum {string} */
                    destinationKind?: "chat-only" | "chat-and-channel";
                    channelId?: string | null;
                    catchUpOnMiss?: boolean;
                    approvalTimeoutMsOverride?: number | null;
                    isEnabled?: boolean;
                };
            };
        };
        responses: {
            /** @description Schedule updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid cron or missing channel. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdSchedulesByScheduleIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Schedule enabled. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdSchedulesByScheduleIdDisable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Schedule disabled. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdSchedulesByScheduleIdRuns: {
        parameters: {
            query?: {
                limit?: number;
                cursorStartedAt?: string;
                cursorId?: string;
            };
            header?: never;
            path: {
                scheduleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ScheduleRun (newest first). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule in this workspace. */
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
