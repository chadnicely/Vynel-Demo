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
        /** Register a directory or single file to index, at workspace or global scope. */
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
        /** Update settings on an installed skill — re-renders SKILL.md (template installs). */
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
    "/workspaces/{workspaceId}/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List rule files this workspace resolves: user ∪ workspace. */
        get: operations["getWorkspacesByWorkspaceIdRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List slash commands this workspace resolves: user ∪ workspace. */
        get: operations["getWorkspacesByWorkspaceIdCommands"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/mcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List MCP servers this workspace resolves: user ∪ workspace, secrets masked. */
        get: operations["getWorkspacesByWorkspaceIdMcp-servers"];
        put?: never;
        /** Add a custom MCP server to this workspace's .mcp.json. */
        post: operations["postWorkspacesByWorkspaceIdMcp-servers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/mcp-servers/{serverName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an MCP server from this workspace's .mcp.json. */
        delete: operations["deleteWorkspacesByWorkspaceIdMcp-serversByServerName"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/marketplace/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List marketplace items annotated with install status. */
        get: operations["getWorkspacesByWorkspaceIdMarketplaceItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/marketplace/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one marketplace item annotated with install status. */
        get: operations["getWorkspacesByWorkspaceIdMarketplaceItemsByItemId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/marketplace/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Install a marketplace item (cloud artifact or bundled skill). */
        post: operations["postWorkspacesByWorkspaceIdMarketplaceInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/marketplace/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update an installed skill or plugin to the catalog’s latest version. */
        post: operations["postWorkspacesByWorkspaceIdMarketplaceUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/marketplace/uninstall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Uninstall a marketplace item (skill hard-delete or agent soft-delete). */
        post: operations["postWorkspacesByWorkspaceIdMarketplaceUninstall"];
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
    "/workspaces/{workspaceId}/schedules/{scheduleId}/fire-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fire a schedule immediately (a manual run; does not affect the next scheduled fire). */
        post: operations["postWorkspacesByWorkspaceIdSchedulesByScheduleIdFire-now"];
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
    "/workspaces/{workspaceId}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tasks for the active workspace (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdTasks"];
        put?: never;
        /** Create a task on the active workspace's list (assistant provenance). */
        post: operations["postWorkspacesByWorkspaceIdTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/tasks/{taskId}": {
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
        /** Update a task (title, detail, or status). */
        patch: operations["patchWorkspacesByWorkspaceIdTasksByTaskId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/tasks/{taskId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark a task done. */
        post: operations["postWorkspacesByWorkspaceIdTasksByTaskIdComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List plans for the active workspace (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdPlans"];
        put?: never;
        /** Create a plan on the active workspace's list (assistant provenance). */
        post: operations["postWorkspacesByWorkspaceIdPlans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/plans/{planId}": {
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
        /** Update a plan (title, detail, date, or status). */
        patch: operations["patchWorkspacesByWorkspaceIdPlansByPlanId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/plans/{planId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark a plan done. */
        post: operations["postWorkspacesByWorkspaceIdPlansByPlanIdComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/monitors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the monitors armed on the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdMonitors"];
        put?: never;
        /** Arm a watch that wakes this conversation when a matching event lands. */
        post: operations["postWorkspacesByWorkspaceIdMonitors"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/monitors/{monitorId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop an armed monitor. */
        post: operations["postWorkspacesByWorkspaceIdMonitorsByMonitorIdStop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/journal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the active workspace's journal (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdJournal"];
        put?: never;
        /** Append an entry to the active workspace's journal (assistant provenance). */
        post: operations["postWorkspacesByWorkspaceIdJournal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the workspace's apps with live run status. */
        get: operations["getWorkspacesByWorkspaceIdApps"];
        put?: never;
        /** Register a runnable app on the workspace. */
        post: operations["postWorkspacesByWorkspaceIdApps"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/apps/{appId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an app (stops it first if running). */
        delete: operations["deleteWorkspacesByWorkspaceIdAppsByAppId"];
        options?: never;
        head?: never;
        /** Update an app (name, command, folder, port). Applies on the next start. */
        patch: operations["patchWorkspacesByWorkspaceIdAppsByAppId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/apps/{appId}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start an app. */
        post: operations["postWorkspacesByWorkspaceIdAppsByAppIdStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/apps/{appId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop a running app. */
        post: operations["postWorkspacesByWorkspaceIdAppsByAppIdStop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/apps/{appId}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read an app's recent output (live ring buffer). */
        get: operations["getWorkspacesByWorkspaceIdAppsByAppIdLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List chat sessions for the workspace (owner-scoped, excludes soft-deleted by default). */
        get: operations["getWorkspacesByWorkspaceIdChatSessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Full-text search across chat messages in the workspace. */
        get: operations["getWorkspacesByWorkspaceIdChatSessionsSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/continuing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resolve the workspace's continuing root conversation (read-only; nulls until the first continue-mode turn). */
        get: operations["getWorkspacesByWorkspaceIdChatContinuing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/turn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start (or resume) a chat turn; streams normalized chat-turn events via SSE. */
        post: operations["postWorkspacesByWorkspaceIdChatSessionsTurn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single chat session's full detail (messages + tool calls grouped by parent message). */
        get: operations["getWorkspacesByWorkspaceIdChatSessionsBySessionId"];
        put?: never;
        post?: never;
        /** Soft-delete a chat session (sets deletedAt; purge job hard-deletes after 30 days). */
        delete: operations["deleteWorkspacesByWorkspaceIdChatSessionsBySessionId"];
        options?: never;
        head?: never;
        /** Rename a chat session. */
        patch: operations["patchWorkspacesByWorkspaceIdChatSessionsBySessionId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}/images/{filename}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Serve a persisted attached image for re-display (owner-scoped). */
        get: operations["getWorkspacesByWorkspaceIdChatSessionsBySessionIdImagesByFilename"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the session's context-window breakdown (the runtime's /context report) as markdown. */
        get: operations["getWorkspacesByWorkspaceIdChatSessionsBySessionIdContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive a chat session (hide from default list). */
        post: operations["postWorkspacesByWorkspaceIdChatSessionsBySessionIdArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unarchive a chat session. */
        post: operations["postWorkspacesByWorkspaceIdChatSessionsBySessionIdUnarchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/chat/sessions/{sessionId}/interrupt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Interrupt an active chat session. */
        post: operations["postWorkspacesByWorkspaceIdChatSessionsBySessionIdInterrupt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List one level of the workspace folder tree. */
        get: operations["getWorkspacesByWorkspaceIdFilesTree"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a file for preview or edit. */
        get: operations["getWorkspacesByWorkspaceIdFilesContent"];
        /** Save the contents of a text file (editor=self). */
        put: operations["putWorkspacesByWorkspaceIdFilesContent"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/raw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Stream a file as raw bytes (for images, PDF, download). */
        get: operations["getWorkspacesByWorkspaceIdFilesRaw"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a new file (editor=self). Refuses if it already exists. */
        post: operations["postWorkspacesByWorkspaceIdFilesFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/directory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a new folder (idempotent; editor=self). */
        post: operations["postWorkspacesByWorkspaceIdFilesDirectory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rename or move a file/folder (editor=self). */
        post: operations["postWorkspacesByWorkspaceIdFilesMove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Hard-delete a file or folder (editor=self). Non-empty dirs require recursive=true. */
        post: operations["postWorkspacesByWorkspaceIdFilesDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List recent file activity for the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdFilesActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/files/activity/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List activity for a single file (per-path history). */
        get: operations["getWorkspacesByWorkspaceIdFilesActivityFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List memory entries for the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdMemoryEntries"];
        put?: never;
        /** Create a memory entry via the panel (user-manual provenance). */
        post: operations["postWorkspacesByWorkspaceIdMemoryEntries"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search memory entries (FTS5, semantic, or hybrid). */
        get: operations["getWorkspacesByWorkspaceIdMemorySearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/entries/from-file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import a single on-disk file as a memory entry. */
        post: operations["postWorkspacesByWorkspaceIdMemoryEntriesFrom-file"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the workspace's memory tags (in use + suggested defaults). */
        get: operations["getWorkspacesByWorkspaceIdMemoryTags"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/entries/{entryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one memory entry by id (workspace-scoped). */
        get: operations["getWorkspacesByWorkspaceIdMemoryEntriesByEntryId"];
        put?: never;
        post?: never;
        /** Soft-delete a memory entry (30-day retention before hard purge). */
        delete: operations["deleteWorkspacesByWorkspaceIdMemoryEntriesByEntryId"];
        options?: never;
        head?: never;
        /** Update a memory entry (title, body, kind, tags, archive state). */
        patch: operations["patchWorkspacesByWorkspaceIdMemoryEntriesByEntryId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/memory/entries/{entryId}/mentions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List recent mentions for one memory entry. */
        get: operations["getWorkspacesByWorkspaceIdMemoryEntriesByEntryIdMentions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List capabilities and their enabled state for the active workspace. */
        get: operations["getWorkspacesByWorkspaceIdCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/capabilities/{capabilityId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Enable or disable a capability for the active workspace. */
        put: operations["putWorkspacesByWorkspaceIdCapabilitiesByCapabilityId"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/approvals/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List pending approval requests for the workspace (workspace-scoped). */
        get: operations["getWorkspacesByWorkspaceIdApprovalsPending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/approvals/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List recent approval requests (cursor-paginated; audit view). */
        get: operations["getWorkspacesByWorkspaceIdApprovalsRecent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/approvals/{providerApprovalId}/decide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve an approval — approve (optionally with edited input and/or remember-rule) or deny (with reason). */
        post: operations["postWorkspacesByWorkspaceIdApprovalsByProviderApprovalIdDecide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/approval-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List approval rules for the workspace (active, non-deleted). */
        get: operations["getWorkspacesByWorkspaceIdApproval-rules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/approval-rules/{ruleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Soft-delete an approval rule (restorable for 30 days; then hard-purged). */
        delete: operations["deleteWorkspacesByWorkspaceIdApproval-rulesByRuleId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/dashboard/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one workspace's token-usage statistics per model per day. */
        get: operations["getWorkspacesByWorkspaceIdDashboardUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every channel the user owns — global + workspace (credentials excluded). */
        get: operations["getChannels"];
        put?: never;
        /** Connect a bot as a global or workspace channel (verifies the token before persisting). */
        post: operations["postChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one channel the user owns (credentials excluded). */
        get: operations["getChannelsByChannelId"];
        put?: never;
        post?: never;
        /** Disconnect a channel — hard-deletes it and cascades inbound/queue/allowlist rows. */
        delete: operations["deleteChannelsByChannelId"];
        options?: never;
        head?: never;
        /** Rename a channel the user owns. */
        patch: operations["patchChannelsByChannelId"];
        trace?: never;
    };
    "/channels/{channelId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a channel (resume polling). */
        post: operations["postChannelsByChannelIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a channel (pause polling). */
        post: operations["postChannelsByChannelIdDisable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/allowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the allowed senders (allowlist) for a channel the user owns. */
        get: operations["getChannelsByChannelIdAllowed-senders"];
        put?: never;
        /** Add an allowed sender to a channel the user owns. */
        post: operations["postChannelsByChannelIdAllowed-senders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/allowed-senders/{senderLinkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an allowed sender from a channel the user owns. */
        delete: operations["deleteChannelsByChannelIdAllowed-sendersBySenderLinkId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a channel's discovered group rooms (pending, approved, and ignored). */
        get: operations["getChannelsByChannelIdGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/groups/{groupId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a discovered group — @mentions in it start routing to the assistant. */
        post: operations["postChannelsByChannelIdGroupsByGroupIdApprove"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/groups/{groupId}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ignore a group — its messages are skipped (also revokes a prior approval). */
        post: operations["postChannelsByChannelIdGroupsByGroupIdIgnore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/groups/{groupId}": {
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
        /** Set a group's member policy: everyone in the room, or allowed senders only. */
        patch: operations["patchChannelsByChannelIdGroupsByGroupId"];
        trace?: never;
    };
    "/channels/{channelId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a channel's inbound message history (keyset cursor-paginated). */
        get: operations["getChannelsByChannelIdHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schedules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every schedule the user owns — global + workspace. */
        get: operations["getSchedules"];
        put?: never;
        /** Create a global or workspace schedule (recurring cron OR one-time fireAt). */
        post: operations["postSchedules"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schedules/{scheduleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a schedule the user owns (hard delete; cascades to its run history). */
        delete: operations["deleteSchedulesByScheduleId"];
        options?: never;
        head?: never;
        /** Update a schedule the user owns. */
        patch: operations["patchSchedulesByScheduleId"];
        trace?: never;
    };
    "/schedules/{scheduleId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a schedule the user owns. */
        post: operations["postSchedulesByScheduleIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schedules/{scheduleId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a schedule the user owns. */
        post: operations["postSchedulesByScheduleIdDisable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schedules/{scheduleId}/fire-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fire a schedule the user owns immediately (a manual run; does not affect the next scheduled fire). */
        post: operations["postSchedulesByScheduleIdFire-now"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schedules/{scheduleId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a schedule's run history (owner-scoped, newest first, keyset-paginated). */
        get: operations["getSchedulesByScheduleIdRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every task the user owns — global + workspace. */
        get: operations["getTasks"];
        put?: never;
        /** Create a global or workspace task (user provenance). */
        post: operations["postTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a task the user owns (hard delete). */
        delete: operations["deleteTasksByTaskId"];
        options?: never;
        head?: never;
        /** Update a task the user owns (title, detail, or status). */
        patch: operations["patchTasksByTaskId"];
        trace?: never;
    };
    "/todos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List one session's working steps, in order. */
        get: operations["getTodos"];
        /** Replace the calling session's working-step list. */
        put: operations["putTodos"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/todos/{todoId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a working step (hard delete). */
        delete: operations["deleteTodosByTodoId"];
        options?: never;
        head?: never;
        /** Move a working step (open / in-progress / done). */
        patch: operations["patchTodosByTodoId"];
        trace?: never;
    };
    "/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every plan the user owns — global + workspace. */
        get: operations["getPlans"];
        put?: never;
        /** Create a global or workspace plan (user provenance). */
        post: operations["postPlans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/{planId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a plan the user owns (hard delete). */
        delete: operations["deletePlansByPlanId"];
        options?: never;
        head?: never;
        /** Update a plan the user owns (title, detail, date, or status). */
        patch: operations["patchPlansByPlanId"];
        trace?: never;
    };
    "/monitors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the monitors armed on the global conversation. */
        get: operations["getMonitors"];
        put?: never;
        /** Arm a watch that wakes the global conversation. */
        post: operations["postMonitors"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/monitors/{monitorId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop an armed monitor. */
        post: operations["postMonitorsByMonitorIdStop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read every journal entry the user owns — global + workspace. */
        get: operations["getJournal"];
        put?: never;
        /** Create a global or workspace journal entry (user provenance). */
        post: operations["postJournal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/journal/{entryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a journal entry the user owns (hard delete). */
        delete: operations["deleteJournalByEntryId"];
        options?: never;
        head?: never;
        /** Update a journal entry the user owns (content or date). */
        patch: operations["patchJournalByEntryId"];
        trace?: never;
    };
    "/asks/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's pending asks (forms Claude is waiting on). */
        get: operations["getAsksPending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/asks/{askId}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Answer a pending ask (unblocks the waiting turn). */
        post: operations["postAsksByAskIdAnswer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/asks/{askId}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dismiss a pending ask (the turn proceeds without the answers). */
        post: operations["postAsksByAskIdDismiss"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ssh-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's registered SSH servers — global + workspace. */
        get: operations["getSsh-servers"];
        put?: never;
        /** Register an SSH server (the credential is sealed and never returned). */
        post: operations["postSsh-servers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ssh-servers/{serverId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an SSH server the user owns (hard delete). */
        delete: operations["deleteSsh-serversByServerId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ssh-servers/{serverId}/test-connection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test the connection to a registered server (pins the host key on first use). */
        post: operations["postSsh-serversByServerIdTest-connection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server-install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's remote engine installs. */
        get: operations["getServer-install"];
        put?: never;
        /** Provision a remote engine on a server over SSH (runs in the background). */
        post: operations["postServer-install"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server-install/{installId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one remote engine install (status + step + error). */
        get: operations["getServer-installByInstallId"];
        put?: never;
        post?: never;
        /** Forget a remote engine install (does not uninstall from the server). */
        delete: operations["deleteServer-installByInstallId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server-install/{installId}/reprovision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update the server's engine to the version this app ships. */
        post: operations["postServer-installByInstallIdReprovision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server-install/{installId}/claude-auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Whether the remote engine is signed in to the user's Claude account. */
        get: operations["getServer-installByInstallIdClaude-auth"];
        put?: never;
        /** Start signing the remote engine in to Claude (returns the link to open). */
        post: operations["postServer-installByInstallIdClaude-auth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server-install/{installId}/claude-auth/code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Give the server the code copied from the browser, finishing sign-in. */
        post: operations["postServer-installByInstallIdClaude-authCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/marketplace/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the GLOBAL marketplace (user-level items), annotated with install status. */
        get: operations["getMarketplaceItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/marketplace/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Install a marketplace item at USER scope (available in every workspace). */
        post: operations["postMarketplaceInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/marketplace/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update a USER-scope installed skill or plugin to the catalog’s latest version. */
        post: operations["postMarketplaceUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/marketplace/uninstall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Uninstall a marketplace item installed at USER scope. */
        post: operations["postMarketplaceUninstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notebook/playbooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the playbook shelf — verified books plus the user's own. */
        get: operations["getNotebookPlaybooks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notebook/playbooks/{playbookId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read one playbook (verified or the user's own) with its full body. */
        get: operations["getNotebookPlaybooksByPlaybookId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notebook/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every notebook document the user owns (both scopes, disabled included). */
        get: operations["getNotebookDocuments"];
        put?: never;
        /** Create a notebook document (a user-authored book). */
        post: operations["postNotebookDocuments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notebook/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a notebook document the user owns. */
        delete: operations["deleteNotebookDocumentsByDocumentId"];
        options?: never;
        head?: never;
        /** Update a notebook document the user owns (title, body, enabled). */
        patch: operations["patchNotebookDocumentsByDocumentId"];
        trace?: never;
    };
    "/knowledge/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's GLOBAL knowledge sources (no workspace anchor). */
        get: operations["getKnowledgeSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/memory/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's GLOBAL memory entries (no workspace anchor). */
        get: operations["getMemoryEntries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/installed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's USER-SCOPE installed skills (the global view). */
        get: operations["getSkillsInstalled"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every rule file in the user's ~/.claude/rules folder. */
        get: operations["getRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's global slash commands (~/.claude/commands). */
        get: operations["getCommands"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's global MCP servers (~/.claude.json), secrets masked. */
        get: operations["getMcp-servers"];
        put?: never;
        /** Add a custom MCP server to the global config (~/.claude.json). */
        post: operations["postMcp-servers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mcp-servers/{serverName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an MCP server from the global config. */
        delete: operations["deleteMcp-serversByServerName"];
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
    "/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the authenticated user. */
        get: operations["getUsersMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update the authenticated user profile. */
        patch: operations["patchUsersMe"];
        trace?: never;
    };
    "/users/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the resolved user preferences (defaults filled). */
        get: operations["getUsersMePreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update one or more user preferences. */
        patch: operations["patchUsersMePreferences"];
        trace?: never;
    };
    "/onboarding/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start or resume the onboarding run for the current user. */
        post: operations["postOnboardingStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/onboarding/restart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Abandon any in-progress run and start a fresh one. */
        post: operations["postOnboardingRestart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/onboarding/status/needs-onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Whether the current user still needs onboarding. */
        get: operations["getOnboardingStatusNeeds-onboarding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/onboarding/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the onboarding run status snapshot (owner-scoped). */
        get: operations["getOnboardingByRunId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/onboarding/{runId}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit one wizard step and advance the run. */
        post: operations["postOnboardingByRunIdSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List available AI agent providers with installation + authentication status. */
        get: operations["getProviders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/providers/{providerId}/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get install + auth status for one AI agent provider. */
        get: operations["getProvidersByProviderIdAuth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/providers/{providerId}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the models the provider engine reports it can run. */
        get: operations["getProvidersByProviderIdModels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/providers/{providerId}/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Discover skills installed for one AI agent provider. */
        get: operations["getProvidersByProviderIdSkills"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agents: user-scope ∪ a workspace, or user-scope only (no workspaceId). */
        get: operations["getAgents"];
        put?: never;
        /** Create an agent (user-built; source "user"). */
        post: operations["postAgents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/curated": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the Vynel-curated agent catalog (the browse + install source). */
        get: operations["getAgentsCurated"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/curated/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Install a Vynel-curated agent from the catalog into a scope. */
        post: operations["postAgentsCuratedInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one agent by slug within an exact scope. */
        get: operations["getAgentsBySlug"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{agentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Soft-delete an agent (retention window before purge). */
        delete: operations["deleteAgentsByAgentId"];
        options?: never;
        head?: never;
        /** Update an agent (persona, runtime, tools, preloaded skills). */
        patch: operations["patchAgentsByAgentId"];
        trace?: never;
    };
    "/agents/{agentId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable or disable an agent for the session resolver. */
        post: operations["postAgentsByAgentIdEnable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/continuing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resolve the global root conversation (read-only; nulls until the first global-root turn). */
        get: operations["getRootContinuing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/transcript": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the global root conversation history (messages across swap segments). */
        get: operations["getRootTranscript"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/trace/{partialSessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the condensed delegation trace for one request (by partialSessionId). */
        get: operations["getRootTraceByPartialSessionId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/trace/{partialSessionId}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Observe a live delegation's turn — streams its ChatTurnEvents via SSE. */
        get: operations["getRootTraceByPartialSessionIdStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one owned session in full (messages + tool calls) — for the trace drill-down. */
        get: operations["getRootSessionsBySessionId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/delegations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's in-flight delegations (pending + claimed) for the processing indicator. */
        get: operations["getRootDelegations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/delegations/{partialSessionId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop a delegation — fail it before claim, or cancel + interrupt its running turn. */
        post: operations["postRootDelegationsByPartialSessionIdStop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/turn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start a global-root turn (LLM-native routing); streams normalized session events via SSE. */
        post: operations["postRootTurn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/root/turn/interrupt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Interrupt the global root's running turn (the workspace interrupt's sibling). */
        post: operations["postRootTurnInterrupt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's workspaces as routing targets (global-root manager view). */
        get: operations["getRoutingWorkspaces"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/delegate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enqueue a task for a workspace; it runs in the background and reports back. */
        post: operations["postRoutingDelegate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/delegate-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enqueue a task for a spawned session; it runs in the background and reports back. */
        post: operations["postRoutingDelegate-session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Report a result up to the conversation that requested this work. */
        post: operations["postRoutingReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's channels as send targets (global-root view). */
        get: operations["getRoutingChannels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/send-to-channel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a message to one of the user's channels (proactive push). */
        post: operations["postRoutingSend-to-channel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/reply-to-channel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reply to the channel conversation that drove this turn. */
        post: operations["postRoutingReply-to-channel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/background-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the work handed off to workspaces and sessions, newest first. */
        get: operations["getRoutingBackground-runs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/background-runs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one background run, with the full text it reported back. */
        get: operations["getRoutingBackground-runsByJobId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routing/message": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a message to another session — a task down, or a result back up. */
        post: operations["postRoutingMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/activity/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Subscribe to the session-activity feed (SSE turn liveness, snapshot + live). */
        get: operations["getActivityStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/voice/speak": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Speak text aloud through the user's voice (the Jarvis speaker). */
        post: operations["postVoiceSpeak"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the Home dashboard's aggregate read (workspaces + recent chat activity + upcoming schedules + tasks). */
        get: operations["getDashboardOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get token-usage statistics per model per day (all scopes). */
        get: operations["getDashboardUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every session across scopes — continuity chains folded into single entries, newest first. */
        get: operations["getSessionsOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/spawned": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a spawned session — a named, purpose-primed continuing session. */
        post: operations["postSessionsSpawned"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{sessionId}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Observe a session's live turn — streams its ChatTurnEvents via SSE. */
        get: operations["getSessionsBySessionIdStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{sessionId}/turn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run an interactive user turn on a spawned session — SSE ChatTurnEvents. */
        post: operations["postSessionsBySessionIdTurn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hub/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The desktop's hub-account link status. */
        get: operations["getHubSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hub/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in to the Vynel hub with email + password. */
        post: operations["postHubSign-in"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hub/sign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign this device out of the Vynel hub. */
        post: operations["postHubSign-out"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hub/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The hub account's signed-in devices. */
        get: operations["getHubDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hub/devices/{deviceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke one signed-in device (its session dies at next contact). */
        delete: operations["deleteHubDevicesByDeviceId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the user's workspaces, ordered by recency. */
        get: operations["getWorkspaces"];
        put?: never;
        /** Register an existing directory as a workspace. */
        post: operations["postWorkspaces"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/directories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List subdirectories of a local path — backs the workspace folder picker. */
        get: operations["getWorkspacesDirectories"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one workspace by id (owner-scoped — 404 if not owned). */
        get: operations["getWorkspacesByWorkspaceId"];
        put?: never;
        post?: never;
        /** Hard-delete a workspace. The caller explicitly chooses whether to delete files on disk. */
        delete: operations["deleteWorkspacesByWorkspaceId"];
        options?: never;
        head?: never;
        /** Update workspace metadata (name + manager persona + continue-mode toggle; path and kind are immutable). */
        patch: operations["patchWorkspacesByWorkspaceId"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive a workspace (hide from the default list; the folder stays on disk). */
        post: operations["postWorkspacesByWorkspaceIdArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unarchive a workspace (restore it to the default list). */
        post: operations["postWorkspacesByWorkspaceIdUnarchive"];
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
                            /** @enum {string} */
                            sourceKind: "directory" | "file";
                            absolutePath: string;
                            createdAt: string;
                            updatedAt: string;
                            documentCount: number;
                            indexedDocumentCount: number;
                            failedDocumentCount: number;
                            lastIndexedAt: string | null;
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
                            /** @enum {string} */
                            sourceKind: "directory" | "file";
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
                content: {
                    "application/json": {
                        skillId: string;
                        displayName: string;
                        oneLineDescription: string;
                        /** @enum {string} */
                        category: "email" | "documents" | "calendar" | "files" | "research" | "notes" | "context" | "creative" | "communication";
                        iconName: string;
                        version: string;
                        /** @enum {string} */
                        recommendedScope: "user" | "workspace";
                        isSystemInstalled: boolean;
                        settingsSchema: {
                            settingKey: string;
                            displayLabel: string;
                            description: string;
                            /** @enum {string} */
                            type: "string" | "number" | "boolean" | "string-enum";
                            defaultValue: string | number | boolean;
                            enumValues?: string[];
                            validationConstraints?: {
                                min?: number;
                                max?: number;
                                minLength?: number;
                                maxLength?: number;
                            };
                        }[];
                    }[];
                };
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
                content: {
                    "application/json": {
                        id: string;
                        skillId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        installedFromSource: "verified-catalog" | "marketplace" | "external";
                        versionInstalled: string;
                        /** @enum {string} */
                        installHealth: "healthy" | "missing-on-disk" | "mcp-config-drift" | "failed-install";
                        installHealthMessage: string | null;
                        installedAt: string;
                        updatedAt: string;
                        definition: {
                            skillId: string;
                            displayName: string;
                            oneLineDescription: string;
                            /** @enum {string} */
                            category: "email" | "documents" | "calendar" | "files" | "research" | "notes" | "context" | "creative" | "communication";
                            iconName: string;
                            version: string;
                            /** @enum {string} */
                            recommendedScope: "user" | "workspace";
                            isSystemInstalled: boolean;
                            settingsSchema: {
                                settingKey: string;
                                displayLabel: string;
                                description: string;
                                /** @enum {string} */
                                type: "string" | "number" | "boolean" | "string-enum";
                                defaultValue: string | number | boolean;
                                enumValues?: string[];
                                validationConstraints?: {
                                    min?: number;
                                    max?: number;
                                    minLength?: number;
                                    maxLength?: number;
                                };
                            }[];
                        } | null;
                        resolvedSettings: {
                            [key: string]: string | number | boolean;
                        };
                    }[];
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
                content: {
                    "application/json": {
                        id: string;
                        skillId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        installedFromSource: "verified-catalog" | "marketplace" | "external";
                        versionInstalled: string;
                        /** @enum {string} */
                        installHealth: "healthy" | "missing-on-disk" | "mcp-config-drift" | "failed-install";
                        installHealthMessage: string | null;
                        installedAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        [key: string]: string | number | boolean;
                    };
                };
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
                content: {
                    "application/json": {
                        healthyCount: number;
                        missingOnDiskCount: number;
                        externalDiscoveredCount: number;
                    };
                };
            };
        };
    };
    getWorkspacesByWorkspaceIdRules: {
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
            /** @description All rule files across both scopes, scope + provenance per row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rules: {
                            ruleId: string;
                            fileName: string;
                            title: string;
                            content: string;
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            marketplace: {
                                ruleId: string;
                                version: string;
                            } | null;
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
    getWorkspacesByWorkspaceIdCommands: {
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
            /** @description One row per command file across both scopes, scope per row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        commands: {
                            commandName: string;
                            relativePath: string;
                            description: string | null;
                            argumentHint: string | null;
                            bodyPreview: string | null;
                            /** @enum {string} */
                            scope: "user" | "workspace";
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
    "getWorkspacesByWorkspaceIdMcp-servers": {
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
            /** @description Masked rows with a scope chip each (user | workspace). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        servers: {
                            serverName: string;
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            /** @enum {string} */
                            transport: "stdio" | "http" | "sse";
                            commandOrUrl: string;
                            args: string[];
                            environmentKeys: string[];
                            headers: {
                                name: string;
                                hasValue: boolean;
                            }[];
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
    "postWorkspacesByWorkspaceIdMcp-servers": {
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
                    serverName: string;
                    /** @constant */
                    transport: "stdio";
                    command: string;
                    /** @default [] */
                    args?: string[];
                    /** @default {} */
                    environment?: {
                        [key: string]: string;
                    };
                } | {
                    serverName: string;
                    /** @constant */
                    transport: "http";
                    url: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                } | {
                    serverName: string;
                    /** @constant */
                    transport: "sse";
                    url: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description The added server, masked. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        serverName: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        transport: "stdio" | "http" | "sse";
                        commandOrUrl: string;
                        args: string[];
                        environmentKeys: string[];
                        headers: {
                            name: string;
                            hasValue: boolean;
                        }[];
                    };
                };
            };
            /** @description Invalid body, or a non-https remote URL (loopback exempt). */
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
            /** @description A server with that name already exists in this workspace's config. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteWorkspacesByWorkspaceIdMcp-serversByServerName": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                serverName: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found, or no such server in this workspace's config. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdMarketplaceItems: {
        parameters: {
            query?: {
                category?: string;
                publisherTier?: "verified" | "anthropic-official" | "community";
                installState?: "installed" | "not-installed";
                searchQuery?: string;
                sortBy?: "recommended" | "name-asc" | "newest";
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Annotated marketplace items. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        itemId: string;
                        /** @enum {string} */
                        kind: "skill" | "agent" | "plugin" | "mcp" | "rule";
                        skillId: string;
                        /** @enum {string} */
                        publisherTier: "verified" | "anthropic-official" | "community";
                        publisherName: string;
                        publisherUrl: string | null;
                        sourceUrl: string | null;
                        displayName: string;
                        oneLineDescription: string;
                        category: string;
                        iconName: string;
                        version: string;
                        releasedAt: string;
                        /** @enum {string} */
                        recommendedScope: "user" | "workspace";
                        /** @enum {string} */
                        scope: "user" | "workspace" | "both";
                        isOfficial: boolean;
                        pluginKey?: string;
                        mcpServerName?: string;
                        hasCloudArtifact: boolean;
                        installStatus: {
                            /** @constant */
                            kind: "not-installed";
                        } | {
                            /** @constant */
                            kind: "installed";
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            installedId: string;
                            versionInstalled: string | null;
                        };
                        /** @enum {string} */
                        minimumTier?: "basic" | "pro";
                    }[];
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
    getWorkspacesByWorkspaceIdMarketplaceItemsByItemId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                itemId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The annotated marketplace item. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        itemId: string;
                        /** @enum {string} */
                        kind: "skill" | "agent" | "plugin" | "mcp" | "rule";
                        skillId: string;
                        /** @enum {string} */
                        publisherTier: "verified" | "anthropic-official" | "community";
                        publisherName: string;
                        publisherUrl: string | null;
                        sourceUrl: string | null;
                        displayName: string;
                        oneLineDescription: string;
                        category: string;
                        iconName: string;
                        version: string;
                        releasedAt: string;
                        /** @enum {string} */
                        recommendedScope: "user" | "workspace";
                        /** @enum {string} */
                        scope: "user" | "workspace" | "both";
                        isOfficial: boolean;
                        pluginKey?: string;
                        mcpServerName?: string;
                        hasCloudArtifact: boolean;
                        installStatus: {
                            /** @constant */
                            kind: "not-installed";
                        } | {
                            /** @constant */
                            kind: "installed";
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            installedId: string;
                            versionInstalled: string | null;
                        };
                        /** @enum {string} */
                        minimumTier?: "basic" | "pro";
                    };
                };
            };
            /** @description Item not in catalog OR workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdMarketplaceInstall: {
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
                    itemId: string;
                    /** @enum {string} */
                    scope: "user" | "workspace";
                };
            };
        };
        responses: {
            /** @description The installed skill. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        source: "verified-catalog" | "marketplace" | "external";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "agent";
                        agentId: string;
                        slug: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                        version: string | null;
                    } | {
                        /** @constant */
                        kind: "mcp";
                        serverName: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string | null;
                    } | {
                        /** @constant */
                        kind: "rule";
                        ruleId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string;
                    };
                };
            };
            /** @description The caller’s tier may not install this item. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in catalog OR workspace not found. */
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
    postWorkspacesByWorkspaceIdMarketplaceUpdate: {
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
                    itemId: string;
                };
            };
        };
        responses: {
            /** @description The updated installation, discriminated by kind (skill or plugin). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        source: "verified-catalog" | "marketplace" | "external";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                        version: string | null;
                    };
                };
            };
            /** @description Kind without in-place update, no cloud version, or hub unavailable. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in catalog, not installed, OR workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdMarketplaceUninstall: {
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
                    itemId: string;
                };
            };
        };
        responses: {
            /** @description The removed installation, discriminated by item kind. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "agent";
                        agentId: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "mcp";
                        serverName: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "rule";
                        ruleId: string;
                        itemId: string;
                    };
                };
            };
            /** @description The skill is system-installed; uninstall blocked. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in catalog, not installed, OR workspace not found. */
            404: {
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
                    channelKind: "telegram" | "discord" | "zoom";
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalSenderId: string;
                        externalSenderHandle: string | null;
                        externalSenderDisplayName: string | null;
                        scopeContextId: string | null;
                        addedAt: string;
                    }[];
                };
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalSenderId: string;
                        externalSenderHandle: string | null;
                        externalSenderDisplayName: string | null;
                        scopeContextId: string | null;
                        addedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalMessageId: string;
                        externalSenderId: string;
                        externalChatContextId: string;
                        messageBody: string;
                        messageMetadata: string;
                        /** @enum {string} */
                        intentKind: "chat-turn" | "approval-reply" | "channel-command" | "ignored";
                        routedToChatSessionId: string | null;
                        routedToApprovalRequestId: string | null;
                        /** @enum {string} */
                        status: "pending" | "routed" | "completed" | "failed" | "ignored";
                        statusMessage: string | null;
                        receivedAt: string;
                        processedAt: string | null;
                    }[];
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        displayLabel: string;
                        oneLineDescription: string;
                        iconName: string;
                        defaultCronExpression: string;
                        /** @enum {string} */
                        defaultDestinationKind: "chat-only" | "chat-and-channel";
                        defaultCatchUpOnMiss: boolean;
                        defaultApprovalTimeoutMsOverride: number | null;
                        promptTemplate: string;
                        recommendedFor: string;
                        deliversVerbatim?: boolean;
                    }[];
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
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
    "postWorkspacesByWorkspaceIdSchedulesByScheduleIdFire-now": {
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
            /** @description Run started. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        scheduleId: string;
                        scheduledFireAt: string;
                        startedAt: string;
                        completedAt: string | null;
                        chatSessionId: string | null;
                        /** @enum {string} */
                        status: "pending" | "running" | "completed" | "failed" | "missed";
                        statusMessage: string | null;
                        /** @enum {string} */
                        triggerKind: "poll" | "catchup" | "manual";
                    };
                };
            };
            /** @description No such schedule in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The schedule is paused. */
            409: {
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
                content: {
                    "application/json": {
                        id: string;
                        scheduleId: string;
                        scheduledFireAt: string;
                        startedAt: string;
                        completedAt: string | null;
                        chatSessionId: string | null;
                        /** @enum {string} */
                        status: "pending" | "running" | "completed" | "failed" | "missed";
                        statusMessage: string | null;
                        /** @enum {string} */
                        triggerKind: "poll" | "catchup" | "manual";
                    }[];
                };
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
    getWorkspacesByWorkspaceIdTasks: {
        parameters: {
            query?: {
                status?: "open" | "in-progress" | "done";
                planId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Task. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    postWorkspacesByWorkspaceIdTasks: {
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
                    title: string;
                    detail?: string;
                    sessionId?: string;
                    planId?: string;
                };
            };
        };
        responses: {
            /** @description Task created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
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
    patchWorkspacesByWorkspaceIdTasksByTaskId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                taskId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    detail?: string | null;
                    /** @enum {string} */
                    status?: "open" | "in-progress" | "done";
                    planId?: string | null;
                };
            };
        };
        responses: {
            /** @description Task updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such task owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdTasksByTaskIdComplete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                taskId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task completed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such task owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdPlans: {
        parameters: {
            query?: {
                status?: "open" | "in-progress" | "done";
                planDate?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Plan. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    postWorkspacesByWorkspaceIdPlans: {
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
                    title: string;
                    detail?: string;
                    planDate: string;
                    sessionId?: string;
                };
            };
        };
        responses: {
            /** @description Plan created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
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
    patchWorkspacesByWorkspaceIdPlansByPlanId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                planId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    detail?: string | null;
                    planDate?: string;
                    /** @enum {string} */
                    status?: "open" | "in-progress" | "done";
                };
            };
        };
        responses: {
            /** @description Plan updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such plan owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdPlansByPlanIdComplete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                planId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Plan completed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such plan owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdMonitors: {
        parameters: {
            query?: {
                status?: "armed" | "fired" | "stopped" | "expired";
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Monitor. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    }[];
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
    postWorkspacesByWorkspaceIdMonitors: {
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
                    description: string;
                    eventTypes: string[];
                    payloadFilter?: {
                        [key: string]: string;
                    };
                    /** @enum {string} */
                    mode?: "once" | "recurring";
                    expiresInMs?: number;
                };
            };
        };
        responses: {
            /** @description Monitor armed. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    };
                };
            };
            /** @description Validation error, or an event type that is not watchable. */
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
    postWorkspacesByWorkspaceIdMonitorsByMonitorIdStop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                monitorId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Monitor stopped. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    };
                };
            };
            /** @description The monitor is already fired, stopped, or expired. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Monitor not found, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdJournal: {
        parameters: {
            query?: {
                entryDate?: string;
                from?: string;
                to?: string;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of JournalEntry. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        entryDate: string;
                        content: string;
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    postWorkspacesByWorkspaceIdJournal: {
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
                    entryDate: string;
                    content: string;
                    sessionId?: string;
                };
            };
        };
        responses: {
            /** @description Journal entry created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        entryDate: string;
                        content: string;
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
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
    getWorkspacesByWorkspaceIdApps: {
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
            /** @description Array of WorkspaceApp (runtime merged). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        name: string;
                        command: string;
                        cwdRelative: string;
                        port: number | null;
                        runtime: {
                            /** @enum {string} */
                            status: "running" | "exited" | "crashed";
                            pid: number | null;
                            startedAt: string;
                            exitCode: number | null;
                        } | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    postWorkspacesByWorkspaceIdApps: {
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
                    name: string;
                    command: string;
                    cwdRelative?: string;
                    port?: number;
                };
            };
        };
        responses: {
            /** @description App registered. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        name: string;
                        command: string;
                        cwdRelative: string;
                        port: number | null;
                        runtime: {
                            /** @enum {string} */
                            status: "running" | "exited" | "crashed";
                            pid: number | null;
                            startedAt: string;
                            exitCode: number | null;
                        } | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
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
            /** @description An app with this name already exists here. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteWorkspacesByWorkspaceIdAppsByAppId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description App removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such app in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchWorkspacesByWorkspaceIdAppsByAppId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    name?: string;
                    command?: string;
                    cwdRelative?: string;
                    port?: number | null;
                };
            };
        };
        responses: {
            /** @description App updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        name: string;
                        command: string;
                        cwdRelative: string;
                        port: number | null;
                        runtime: {
                            /** @enum {string} */
                            status: "running" | "exited" | "crashed";
                            pid: number | null;
                            startedAt: string;
                            exitCode: number | null;
                        } | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such app in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description An app with this name already exists here. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdAppsByAppIdStart: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description App started (runtime merged). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        name: string;
                        command: string;
                        cwdRelative: string;
                        port: number | null;
                        runtime: {
                            /** @enum {string} */
                            status: "running" | "exited" | "crashed";
                            pid: number | null;
                            startedAt: string;
                            exitCode: number | null;
                        } | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description The app's folder escapes the workspace. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such app in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The app is already running. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdAppsByAppIdStop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description App stopped (runtime merged). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        name: string;
                        command: string;
                        cwdRelative: string;
                        port: number | null;
                        runtime: {
                            /** @enum {string} */
                            status: "running" | "exited" | "crashed";
                            pid: number | null;
                            startedAt: string;
                            exitCode: number | null;
                        } | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such app in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdAppsByAppIdLogs: {
        parameters: {
            query?: {
                tail?: number;
            };
            header?: never;
            path: {
                appId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { lines } — the most recent output lines. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        lines: string[];
                    };
                };
            };
            /** @description No such app in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdChatSessions: {
        parameters: {
            query?: {
                includeArchived?: boolean;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ChatSession (+ lastMessagePreview). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        providerId: string;
                        model: string | null;
                        title: string;
                        /** @enum {string} */
                        visibility: "listed" | "hidden";
                        /** @enum {string} */
                        scope: "global" | "workspace" | "agent";
                        isArchived: boolean;
                        deletedAt: string | null;
                        totalMessageCount: number;
                        totalInputTokens: number;
                        totalOutputTokens: number;
                        startedAt: string;
                        lastMessageAt: string;
                        updatedAt: string;
                        lastMessagePreview: string | null;
                    }[];
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
    getWorkspacesByWorkspaceIdChatSessionsSearch: {
        parameters: {
            query: {
                query: string;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ChatMessageSearchResult. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        messageId: string;
                        sessionId: string;
                        snippet: string;
                        rank: number;
                    }[];
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
    getWorkspacesByWorkspaceIdChatContinuing: {
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
            /** @description { rootSessionId, currentSdkSessionId } — nulls when no root exists yet. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rootSessionId: string | null;
                        currentSdkSessionId: string | null;
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
    postWorkspacesByWorkspaceIdChatSessionsTurn: {
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
                    resumeSessionId?: string;
                    continueRoot?: boolean;
                    userMessageText: string;
                    attachedImages?: {
                        filename: string;
                        /** @enum {string} */
                        mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf" | "text/plain" | "text/markdown" | "text/csv" | "text/html" | "application/json" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                        base64Data: string;
                    }[];
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                    /** @enum {string} */
                    mode?: "ask" | "auto" | "bypass";
                };
            };
        };
        responses: {
            /** @description SSE stream of ChatTurnEvent. */
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
    getWorkspacesByWorkspaceIdChatSessionsBySessionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description ChatSessionDetail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        session: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            providerId: string;
                            model: string | null;
                            title: string;
                            /** @enum {string} */
                            visibility: "listed" | "hidden";
                            /** @enum {string} */
                            scope: "global" | "workspace" | "agent";
                            isArchived: boolean;
                            deletedAt: string | null;
                            totalMessageCount: number;
                            totalInputTokens: number;
                            totalOutputTokens: number;
                            startedAt: string;
                            lastMessageAt: string;
                            updatedAt: string;
                        };
                        messages: {
                            id: string;
                            sessionId: string;
                            /** @enum {string} */
                            role: "user" | "assistant" | "system";
                            body: string;
                            /** @enum {string|null} */
                            sourceKind: "user" | "global-root" | "workspace-manager" | "agent" | null;
                            sourceLabel: string | null;
                            /** @enum {string|null} */
                            originChannel: "voice" | "telegram" | "discord" | "zoom" | null;
                            partialSessionId: string | null;
                            delegationTaskLabel?: string | null;
                            thinkingBody: string | null;
                            inputTokens: number | null;
                            outputTokens: number | null;
                            attachedImagesMetadata: {
                                filename: string;
                                mimeType: string;
                                sizeBytes: number;
                            }[] | null;
                            errorCode: string | null;
                            errorMessage: string | null;
                            startedAt: string;
                            completedAt: string | null;
                            createdAt: string;
                        }[];
                        toolCallsByMessageId: {
                            [key: string]: {
                                id: string;
                                parentMessageId: string;
                                toolUseId: string;
                                toolName: string;
                                toolInput?: unknown;
                                toolOutput?: unknown;
                                /** @enum {string} */
                                status: "started" | "completed" | "failed" | "denied" | "cancelled";
                                /** @enum {string|null} */
                                approvalStatus: "approved" | "denied" | "timed-out" | "cancelled" | null;
                                isErrorResult: boolean;
                                subagentNarrative?: string | null;
                                subagentToolCalls?: {
                                    toolUseId: string;
                                    toolName: string;
                                    toolInput?: unknown;
                                    /** @enum {string} */
                                    status: "started" | "completed" | "failed";
                                    startedAt: string;
                                    completedAt: string | null;
                                }[] | null;
                                delegation?: {
                                    jobId: string;
                                    partialSessionId: string | null;
                                    /** @enum {string} */
                                    status: "pending" | "claimed" | "completed" | "failed";
                                    deliveredTo: string | null;
                                    taskLabel: string | null;
                                    reportedAt: string | null;
                                    completedAt: string | null;
                                } | null;
                                startedAt: string;
                                completedAt: string | null;
                            }[];
                        };
                    };
                };
            };
            /** @description Session not found or not in this user's workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteWorkspacesByWorkspaceIdChatSessionsBySessionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Soft-deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchWorkspacesByWorkspaceIdChatSessionsBySessionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title: string;
                };
            };
        };
        responses: {
            /** @description Updated ChatSession. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        providerId: string;
                        model: string | null;
                        title: string;
                        /** @enum {string} */
                        visibility: "listed" | "hidden";
                        /** @enum {string} */
                        scope: "global" | "workspace" | "agent";
                        isArchived: boolean;
                        deletedAt: string | null;
                        totalMessageCount: number;
                        totalInputTokens: number;
                        totalOutputTokens: number;
                        startedAt: string;
                        lastMessageAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Invalid title. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdChatSessionsBySessionIdImagesByFilename: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
                filename: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The image bytes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid filename. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session or image not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdChatSessionsBySessionIdContext: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { report: string | null } — raw /context markdown, null if unavailable. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        report: string | null;
                    };
                };
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdChatSessionsBySessionIdArchive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated ChatSession. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        providerId: string;
                        model: string | null;
                        title: string;
                        /** @enum {string} */
                        visibility: "listed" | "hidden";
                        /** @enum {string} */
                        scope: "global" | "workspace" | "agent";
                        isArchived: boolean;
                        deletedAt: string | null;
                        totalMessageCount: number;
                        totalInputTokens: number;
                        totalOutputTokens: number;
                        startedAt: string;
                        lastMessageAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdChatSessionsBySessionIdUnarchive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated ChatSession. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        providerId: string;
                        model: string | null;
                        title: string;
                        /** @enum {string} */
                        visibility: "listed" | "hidden";
                        /** @enum {string} */
                        scope: "global" | "workspace" | "agent";
                        isArchived: boolean;
                        deletedAt: string | null;
                        totalMessageCount: number;
                        totalInputTokens: number;
                        totalOutputTokens: number;
                        startedAt: string;
                        lastMessageAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdChatSessionsBySessionIdInterrupt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Interrupted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdFilesTree: {
        parameters: {
            query?: {
                path?: string;
                includeHidden?: "true" | "false" | "1" | "0" | boolean;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { entries: SerializedDirectoryEntry[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entries: {
                            name: string;
                            /** @enum {string} */
                            kind: "file" | "directory";
                            relativePath: string;
                            fileSizeBytes: number | null;
                            modifiedAt: string;
                            childCount: number | null;
                        }[];
                    };
                };
            };
            /** @description Invalid path (traversal / NUL byte / absolute). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Directory or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdFilesContent: {
        parameters: {
            query: {
                path: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SerializedFileContent. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        relativePath: string;
                        /** @enum {string} */
                        kind: "markdown" | "plain-text" | "image" | "pdf" | "unsupported";
                        isText: boolean;
                        content: string | null;
                        fileSizeBytes: number;
                        modifiedAt: string;
                        isTruncated: boolean;
                    };
                };
            };
            /** @description Invalid path. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description File or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    putWorkspacesByWorkspaceIdFilesContent: {
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
                    path: string;
                    content: string;
                };
            };
        };
        responses: {
            /** @description SerializedFileMetadata. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        relativePath: string;
                        fileSizeBytes: number;
                        modifiedAt: string;
                    };
                };
            };
            /** @description Invalid path / too large / .vynel guard. */
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
    getWorkspacesByWorkspaceIdFilesRaw: {
        parameters: {
            query: {
                path: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Raw file bytes; content-type per file extension. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid path. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description File or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdFilesFile: {
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
                    path: string;
                    content?: string;
                };
            };
        };
        responses: {
            /** @description SerializedFileMetadata. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        relativePath: string;
                        fileSizeBytes: number;
                        modifiedAt: string;
                    };
                };
            };
            /** @description Invalid path / too large / .vynel guard. */
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
            /** @description A file already exists at that path. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdFilesDirectory: {
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
                    path: string;
                };
            };
        };
        responses: {
            /** @description { relativePath, wasCreated }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        relativePath: string;
                        wasCreated: boolean;
                    };
                };
            };
            /** @description Invalid path / .vynel guard. */
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
    postWorkspacesByWorkspaceIdFilesMove: {
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
                    fromPath: string;
                    toPath: string;
                    overwrite?: boolean;
                };
            };
        };
        responses: {
            /** @description { fromPath, toPath }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fromPath: string;
                        toPath: string;
                    };
                };
            };
            /** @description Invalid path / .vynel guard. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Source not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target already exists; pass overwrite=true to replace. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postWorkspacesByWorkspaceIdFilesDelete: {
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
                    path: string;
                    recursive?: boolean;
                };
            };
        };
        responses: {
            /** @description { relativePath, kind }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        relativePath: string;
                        /** @enum {string} */
                        kind: "file" | "directory";
                    };
                };
            };
            /** @description Invalid path / .vynel guard. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target is a non-empty directory; pass recursive=true. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdFilesActivity: {
        parameters: {
            query?: {
                cursorOccurredAt?: string;
                cursorId?: string;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { activities: SerializedFileActivity[], nextCursor }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activities: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            /** @enum {string} */
                            activityKind: "file-created" | "file-edited" | "file-moved" | "file-deleted" | "folder-created" | "folder-deleted";
                            /** @enum {string} */
                            editor: "self" | "external";
                            relativePath: string;
                            fromPath: string | null;
                            fileSizeBytes: number | null;
                            occurredAt: string;
                        }[];
                        nextCursor: {
                            occurredAt: string;
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
    getWorkspacesByWorkspaceIdFilesActivityFile: {
        parameters: {
            query: {
                path: string;
                cursorOccurredAt?: string;
                cursorId?: string;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { activities: SerializedFileActivity[], nextCursor }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activities: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            /** @enum {string} */
                            activityKind: "file-created" | "file-edited" | "file-moved" | "file-deleted" | "folder-created" | "folder-deleted";
                            /** @enum {string} */
                            editor: "self" | "external";
                            relativePath: string;
                            fromPath: string | null;
                            fileSizeBytes: number | null;
                            occurredAt: string;
                        }[];
                        nextCursor: {
                            occurredAt: string;
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
    getWorkspacesByWorkspaceIdMemoryEntries: {
        parameters: {
            query?: {
                kind?: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                includeArchived?: boolean;
                cursorLastMentionedAt?: string | null;
                cursorId?: string;
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { entries: SerializedMemoryEntry[], nextCursor }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entries: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            /** @enum {string} */
                            kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                            title: string;
                            body: string;
                            /** @enum {string} */
                            category: "user" | "preferences" | "memory";
                            section: string;
                            sourceMessageId: string | null;
                            /** @enum {string} */
                            createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                            embeddingPresent: boolean;
                            embeddingModelVersion: string | null;
                            isArchived: boolean;
                            tags: string[];
                            createdAt: string;
                            updatedAt: string;
                            lastMentionedAt: string | null;
                        }[];
                        nextCursor: {
                            lastMentionedAt: string | null;
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
    postWorkspacesByWorkspaceIdMemoryEntries: {
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
                    kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                    title?: string;
                    body: string;
                    /** @enum {string} */
                    category: "user" | "preferences" | "memory";
                    section: string;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description SerializedMemoryEntry. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        /** @enum {string} */
                        kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                        title: string;
                        body: string;
                        /** @enum {string} */
                        category: "user" | "preferences" | "memory";
                        section: string;
                        sourceMessageId: string | null;
                        /** @enum {string} */
                        createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                        embeddingPresent: boolean;
                        embeddingModelVersion: string | null;
                        isArchived: boolean;
                        tags: string[];
                        createdAt: string;
                        updatedAt: string;
                        lastMentionedAt: string | null;
                    };
                };
            };
            /** @description Validation error. */
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
    getWorkspacesByWorkspaceIdMemorySearch: {
        parameters: {
            query: {
                query: string;
                mode?: "fts" | "semantic" | "hybrid";
                limit?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { results: SerializedMemorySearchResult[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        results: {
                            entryId: string;
                            matchedTitle: string;
                            matchedBody: string;
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
    "postWorkspacesByWorkspaceIdMemoryEntriesFrom-file": {
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
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description SerializedMemoryEntry (imported). */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        /** @enum {string} */
                        kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                        title: string;
                        body: string;
                        /** @enum {string} */
                        category: "user" | "preferences" | "memory";
                        section: string;
                        sourceMessageId: string | null;
                        /** @enum {string} */
                        createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                        embeddingPresent: boolean;
                        embeddingModelVersion: string | null;
                        isArchived: boolean;
                        tags: string[];
                        createdAt: string;
                        updatedAt: string;
                        lastMentionedAt: string | null;
                    };
                };
            };
            /** @description Validation error (missing, unreadable, unsupported, or too long). */
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
    getWorkspacesByWorkspaceIdMemoryTags: {
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
            /** @description { tags: string[] } — "context" always leads. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tags: string[];
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
    getWorkspacesByWorkspaceIdMemoryEntriesByEntryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SerializedMemoryEntry. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        /** @enum {string} */
                        kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                        title: string;
                        body: string;
                        /** @enum {string} */
                        category: "user" | "preferences" | "memory";
                        section: string;
                        sourceMessageId: string | null;
                        /** @enum {string} */
                        createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                        embeddingPresent: boolean;
                        embeddingModelVersion: string | null;
                        isArchived: boolean;
                        tags: string[];
                        createdAt: string;
                        updatedAt: string;
                        lastMentionedAt: string | null;
                    };
                };
            };
            /** @description Memory entry not found in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteWorkspacesByWorkspaceIdMemoryEntriesByEntryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted (no body). */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Memory entry not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchWorkspacesByWorkspaceIdMemoryEntriesByEntryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    body?: string;
                    /** @enum {string} */
                    kind?: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                    isArchived?: boolean;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description SerializedMemoryEntry (updated). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string;
                        /** @enum {string} */
                        kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                        title: string;
                        body: string;
                        /** @enum {string} */
                        category: "user" | "preferences" | "memory";
                        section: string;
                        sourceMessageId: string | null;
                        /** @enum {string} */
                        createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                        embeddingPresent: boolean;
                        embeddingModelVersion: string | null;
                        isArchived: boolean;
                        tags: string[];
                        createdAt: string;
                        updatedAt: string;
                        lastMentionedAt: string | null;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Memory entry not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdMemoryEntriesByEntryIdMentions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { mentions: SerializedMemoryEntryMention[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        mentions: {
                            id: string;
                            memoryEntryId: string;
                            sessionId: string;
                            messageId: string;
                            /** @enum {string} */
                            mentionKind: "session-context-load" | "tool-output" | "agent-citation";
                            mentionedAt: string;
                        }[];
                    };
                };
            };
            /** @description Memory entry not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdCapabilities: {
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
            /** @description { capabilities: CapabilityStatus[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        capabilities: {
                            /** @enum {string} */
                            id: "memory" | "knowledge" | "notebook" | "tasks" | "plans" | "journal";
                            displayName: string;
                            description: string;
                            /** @enum {string} */
                            scope: "workspace";
                            isFirstParty: boolean;
                            isEnabled: boolean;
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
    putWorkspacesByWorkspaceIdCapabilitiesByCapabilityId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                capabilityId: "memory" | "knowledge" | "notebook" | "tasks" | "plans" | "journal";
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    isEnabled: boolean;
                };
            };
        };
        responses: {
            /** @description The updated CapabilityStatus. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        id: "memory" | "knowledge" | "notebook" | "tasks" | "plans" | "journal";
                        displayName: string;
                        description: string;
                        /** @enum {string} */
                        scope: "workspace";
                        isFirstParty: boolean;
                        isEnabled: boolean;
                    };
                };
            };
            /** @description Validation error. */
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
    getWorkspacesByWorkspaceIdApprovalsPending: {
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
            /** @description Array of ApprovalRequest (status=pending). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        providerApprovalId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        parentMessageId: string;
                        toolUseId: string;
                        toolName: string;
                        /** @enum {string} */
                        actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        toolInput?: unknown;
                        /** @enum {string} */
                        status: "pending" | "resolved";
                        /** @enum {string|null} */
                        resolutionKind: "approved" | "denied" | "timed-out" | "cancelled" | null;
                        autoApprovedByRuleId: string | null;
                        requestedAt: string;
                        resolvedAt: string | null;
                    }[];
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
    getWorkspacesByWorkspaceIdApprovalsRecent: {
        parameters: {
            query?: {
                limit?: number;
                cursorRequestedAt?: string;
                cursorId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ApprovalRequest, ordered by requestedAt desc. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        providerApprovalId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        parentMessageId: string;
                        toolUseId: string;
                        toolName: string;
                        /** @enum {string} */
                        actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        toolInput?: unknown;
                        /** @enum {string} */
                        status: "pending" | "resolved";
                        /** @enum {string|null} */
                        resolutionKind: "approved" | "denied" | "timed-out" | "cancelled" | null;
                        autoApprovedByRuleId: string | null;
                        requestedAt: string;
                        resolvedAt: string | null;
                    }[];
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
    postWorkspacesByWorkspaceIdApprovalsByProviderApprovalIdDecide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                providerApprovalId: string;
                workspaceId: string;
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
            /** @description Approval resolved; provider unblocked (ApprovalRequestResponse). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        providerApprovalId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        parentMessageId: string;
                        toolUseId: string;
                        toolName: string;
                        /** @enum {string} */
                        actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        toolInput?: unknown;
                        /** @enum {string} */
                        status: "pending" | "resolved";
                        /** @enum {string|null} */
                        resolutionKind: "approved" | "denied" | "timed-out" | "cancelled" | null;
                        autoApprovedByRuleId: string | null;
                        requestedAt: string;
                        resolvedAt: string | null;
                    };
                };
            };
            /** @description No active approval request with that id in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Approval has already been resolved. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getWorkspacesByWorkspaceIdApproval-rules": {
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
            /** @description Array of ApprovalRule. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        ruleKind: "auto-approve-action-kind" | "auto-approve-tool-name";
                        description: string;
                        matcher: {
                            /** @constant */
                            kind: "auto-approve-action-kind";
                            /** @enum {string} */
                            actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        } | {
                            /** @constant */
                            kind: "auto-approve-tool-name";
                            toolName: string;
                        };
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    "deleteWorkspacesByWorkspaceIdApproval-rulesByRuleId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ruleId: string;
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rule soft-deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No active rule with that id in this workspace. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceIdDashboardUsage: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { rows: [{ day, model, providerId, inputTokens, outputTokens, assistantMessageCount }] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rows: {
                            day: string;
                            model: string | null;
                            providerId: string;
                            inputTokens: number;
                            outputTokens: number;
                            assistantMessageCount: number;
                        }[];
                    };
                };
            };
            /** @description No such workspace owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getChannels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Channel (without bot credentials). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    postChannels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
                    /** @enum {string} */
                    channelKind: "telegram" | "discord" | "zoom";
                    displayName: string;
                    botCredentials: {
                        [key: string]: string;
                    };
                    initialAllowedSenderId?: string;
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
                    /** @enum {string} */
                    channelKind: "telegram" | "discord" | "zoom";
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Bot token invalid, unsupported kind, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getChannelsByChannelId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Channel (without bot credentials). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteChannelsByChannelId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
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
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchChannelsByChannelId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    displayName: string;
                };
            };
        };
        responses: {
            /** @description Updated Channel (credentials excluded). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postChannelsByChannelIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postChannelsByChannelIdDisable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        channelKind: "telegram" | "discord" | "zoom";
                        displayName: string;
                        botMetadata: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        connectionStatus: "healthy" | "auth-failed" | "rate-limited" | "network-error" | "misconfigured";
                        connectionStatusMessage: string | null;
                        lastPolledAt: string | null;
                        lastInboundAt: string | null;
                        isEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getChannelsByChannelIdAllowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalSenderId: string;
                        externalSenderHandle: string | null;
                        externalSenderDisplayName: string | null;
                        scopeContextId: string | null;
                        addedAt: string;
                    }[];
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postChannelsByChannelIdAllowed-senders": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalSenderId: string;
                        externalSenderHandle: string | null;
                        externalSenderDisplayName: string | null;
                        scopeContextId: string | null;
                        addedAt: string;
                    };
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteChannelsByChannelIdAllowed-sendersBySenderLinkId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                senderLinkId: string;
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
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getChannelsByChannelIdGroups: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ChannelChatGroup. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalChatContextId: string;
                        title: string | null;
                        /** @enum {string} */
                        status: "pending" | "approved" | "ignored";
                        /** @enum {string} */
                        memberPolicy: "everyone" | "allowlist";
                        firstSeenAt: string;
                        lastInboundAt: string | null;
                        approvedAt: string | null;
                    }[];
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postChannelsByChannelIdGroupsByGroupIdApprove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                groupId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated ChannelChatGroup. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalChatContextId: string;
                        title: string | null;
                        /** @enum {string} */
                        status: "pending" | "approved" | "ignored";
                        /** @enum {string} */
                        memberPolicy: "everyone" | "allowlist";
                        firstSeenAt: string;
                        lastInboundAt: string | null;
                        approvedAt: string | null;
                    };
                };
            };
            /** @description No such channel or group owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postChannelsByChannelIdGroupsByGroupIdIgnore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                groupId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Updated ChannelChatGroup. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalChatContextId: string;
                        title: string | null;
                        /** @enum {string} */
                        status: "pending" | "approved" | "ignored";
                        /** @enum {string} */
                        memberPolicy: "everyone" | "allowlist";
                        firstSeenAt: string;
                        lastInboundAt: string | null;
                        approvedAt: string | null;
                    };
                };
            };
            /** @description No such channel or group owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchChannelsByChannelIdGroupsByGroupId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channelId: string;
                groupId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    memberPolicy: "everyone" | "allowlist";
                };
            };
        };
        responses: {
            /** @description Updated ChannelChatGroup. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalChatContextId: string;
                        title: string | null;
                        /** @enum {string} */
                        status: "pending" | "approved" | "ignored";
                        /** @enum {string} */
                        memberPolicy: "everyone" | "allowlist";
                        firstSeenAt: string;
                        lastInboundAt: string | null;
                        approvedAt: string | null;
                    };
                };
            };
            /** @description No such channel or group owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getChannelsByChannelIdHistory: {
        parameters: {
            query?: {
                limit?: number;
                cursorReceivedAt?: number;
                cursorId?: string;
            };
            header?: never;
            path: {
                channelId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        channelId: string;
                        externalMessageId: string;
                        externalSenderId: string;
                        externalChatContextId: string;
                        messageBody: string;
                        messageMetadata: string;
                        /** @enum {string} */
                        intentKind: "chat-turn" | "approval-reply" | "channel-command" | "ignored";
                        routedToChatSessionId: string | null;
                        routedToApprovalRequestId: string | null;
                        /** @enum {string} */
                        status: "pending" | "routed" | "completed" | "failed" | "ignored";
                        statusMessage: string | null;
                        receivedAt: string;
                        processedAt: string | null;
                    }[];
                };
            };
            /** @description No such channel owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSchedules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Schedule. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    postSchedules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
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
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Invalid cron, missing channel, past fireAt, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteSchedulesByScheduleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
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
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchSchedulesByScheduleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Invalid cron or missing channel. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postSchedulesByScheduleIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postSchedulesByScheduleIdDisable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                        /** @enum {string} */
                        scheduleKind: "recurring" | "one-time";
                        displayName: string;
                        cronExpression: string | null;
                        timezone: string;
                        promptTemplate: string;
                        /** @enum {string} */
                        destinationKind: "chat-only" | "chat-and-channel";
                        channelId: string | null;
                        catchUpOnMiss: boolean;
                        isEnabled: boolean;
                        approvalTimeoutMsOverride: number | null;
                        lastFiredAt: string | null;
                        nextScheduledFireAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postSchedulesByScheduleIdFire-now": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run started. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        scheduleId: string;
                        scheduledFireAt: string;
                        startedAt: string;
                        completedAt: string | null;
                        chatSessionId: string | null;
                        /** @enum {string} */
                        status: "pending" | "running" | "completed" | "failed" | "missed";
                        statusMessage: string | null;
                        /** @enum {string} */
                        triggerKind: "poll" | "catchup" | "manual";
                    };
                };
            };
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The schedule is paused. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSchedulesByScheduleIdRuns: {
        parameters: {
            query?: {
                limit?: number;
                cursorStartedAt?: string;
                cursorId?: string;
            };
            header?: never;
            path: {
                scheduleId: string;
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
                content: {
                    "application/json": {
                        id: string;
                        scheduleId: string;
                        scheduledFireAt: string;
                        startedAt: string;
                        completedAt: string | null;
                        chatSessionId: string | null;
                        /** @enum {string} */
                        status: "pending" | "running" | "completed" | "failed" | "missed";
                        statusMessage: string | null;
                        /** @enum {string} */
                        triggerKind: "poll" | "catchup" | "manual";
                    }[];
                };
            };
            /** @description No such schedule owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getTasks: {
        parameters: {
            query?: {
                status?: "open" | "in-progress" | "done";
                planId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Task. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    postTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
                    title: string;
                    detail?: string;
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
                    title: string;
                    detail?: string;
                };
            };
        };
        responses: {
            /** @description Task created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteTasksByTaskId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such task owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchTasksByTaskId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    detail?: string | null;
                    /** @enum {string} */
                    status?: "open" | "in-progress" | "done";
                    planId?: string | null;
                };
            };
        };
        responses: {
            /** @description Task updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        planId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such task owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getTodos: {
        parameters: {
            query: {
                sessionId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of SessionTodo. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        title: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        orderIndex: number;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    putTodos: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    todos: {
                        title: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                    }[];
                };
            };
        };
        responses: {
            /** @description The stored list, in order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        title: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        orderIndex: number;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
            /** @description Validation error, or this turn has no watching session. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The calling session could not be resolved. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteTodosByTodoId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                todoId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Step removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such step owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchTodosByTodoId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                todoId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status: "open" | "in-progress" | "done";
                };
            };
        };
        responses: {
            /** @description Step updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        title: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        orderIndex: number;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such step owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getPlans: {
        parameters: {
            query?: {
                status?: "open" | "in-progress" | "done";
                planDate?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Plan. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    postPlans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
                    title: string;
                    detail?: string;
                    planDate: string;
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
                    title: string;
                    detail?: string;
                    planDate: string;
                };
            };
        };
        responses: {
            /** @description Plan created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deletePlansByPlanId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Plan deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such plan owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchPlansByPlanId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                planId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    detail?: string | null;
                    planDate?: string;
                    /** @enum {string} */
                    status?: "open" | "in-progress" | "done";
                };
            };
        };
        responses: {
            /** @description Plan updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        title: string;
                        detail: string | null;
                        planDate: string;
                        /** @enum {string} */
                        status: "open" | "in-progress" | "done";
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        completedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such plan owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getMonitors: {
        parameters: {
            query?: {
                status?: "armed" | "fired" | "stopped" | "expired";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of Monitor. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    }[];
                };
            };
        };
    };
    postMonitors: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    description: string;
                    eventTypes: string[];
                    payloadFilter?: {
                        [key: string]: string;
                    };
                    /** @enum {string} */
                    mode?: "once" | "recurring";
                    expiresInMs?: number;
                };
            };
        };
        responses: {
            /** @description Monitor armed. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    };
                };
            };
            /** @description Validation error, or an event type that is not watchable. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postMonitorsByMonitorIdStop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                monitorId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Monitor stopped. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        ownerKind: "global-root" | "workspace-primary" | "spawned-session";
                        description: string;
                        eventTypes: string[];
                        payloadFilter: {
                            [key: string]: string;
                        } | null;
                        /** @enum {string} */
                        mode: "once" | "recurring";
                        /** @enum {string} */
                        status: "armed" | "fired" | "stopped" | "expired";
                        expiresAt: string;
                        firedCount: number;
                        lastFiredAt: string | null;
                        createdAt: string;
                    };
                };
            };
            /** @description The monitor is already fired, stopped, or expired. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Monitor not found, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getJournal: {
        parameters: {
            query?: {
                entryDate?: string;
                from?: string;
                to?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of JournalEntry. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        entryDate: string;
                        content: string;
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    postJournal: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
                    entryDate: string;
                    content: string;
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
                    entryDate: string;
                    content: string;
                };
            };
        };
        responses: {
            /** @description Journal entry created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        entryDate: string;
                        content: string;
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteJournalByEntryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Journal entry deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such journal entry owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchJournalByEntryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    content?: string;
                    entryDate?: string;
                };
            };
        };
        responses: {
            /** @description Journal entry updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        entryDate: string;
                        content: string;
                        /** @enum {string} */
                        source: "assistant" | "user";
                        sessionId: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such journal entry owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAsksPending: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of AskRequest (pending only, newest first). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string | null;
                        questions: {
                            id: string;
                            label: string;
                            hint?: string;
                            /** @enum {string} */
                            type: "text" | "choice" | "multi-choice" | "yes-no" | "number";
                            required?: boolean;
                            options?: string[];
                            placeholder?: string;
                        }[];
                        answers: {
                            [key: string]: string | string[] | number | boolean;
                        } | null;
                        /** @enum {string} */
                        status: "pending" | "answered" | "dismissed" | "expired";
                        createdAt: string;
                        resolvedAt: string | null;
                    }[];
                };
            };
        };
    };
    postAsksByAskIdAnswer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                askId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    answers: {
                        [key: string]: string | string[] | number | boolean;
                    };
                };
            };
        };
        responses: {
            /** @description AskRequest (answered). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string | null;
                        questions: {
                            id: string;
                            label: string;
                            hint?: string;
                            /** @enum {string} */
                            type: "text" | "choice" | "multi-choice" | "yes-no" | "number";
                            required?: boolean;
                            options?: string[];
                            placeholder?: string;
                        }[];
                        answers: {
                            [key: string]: string | string[] | number | boolean;
                        } | null;
                        /** @enum {string} */
                        status: "pending" | "answered" | "dismissed" | "expired";
                        createdAt: string;
                        resolvedAt: string | null;
                    };
                };
            };
            /** @description The answers don't fit the form. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such pending ask owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The ask was already resolved. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postAsksByAskIdDismiss: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                askId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description AskRequest (dismissed). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        sessionId: string | null;
                        questions: {
                            id: string;
                            label: string;
                            hint?: string;
                            /** @enum {string} */
                            type: "text" | "choice" | "multi-choice" | "yes-no" | "number";
                            required?: boolean;
                            options?: string[];
                            placeholder?: string;
                        }[];
                        answers: {
                            [key: string]: string | string[] | number | boolean;
                        } | null;
                        /** @enum {string} */
                        status: "pending" | "answered" | "dismissed" | "expired";
                        createdAt: string;
                        resolvedAt: string | null;
                    };
                };
            };
            /** @description No such pending ask owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The ask was already resolved. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getSsh-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of SshServer (never includes credentials). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        name: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        lastConnectedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    "postSsh-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    scope: "global";
                    name: string;
                    host: string;
                    port?: number;
                    username: string;
                    credentials: {
                        /** @constant */
                        authKind: "password";
                        password: string;
                    } | {
                        /** @constant */
                        authKind: "private-key";
                        privateKey: string;
                        passphrase?: string;
                    };
                } | {
                    /** @constant */
                    scope: "workspace";
                    workspaceId: string;
                    name: string;
                    host: string;
                    port?: number;
                    username: string;
                    credentials: {
                        /** @constant */
                        authKind: "password";
                        password: string;
                    } | {
                        /** @constant */
                        authKind: "private-key";
                        privateKey: string;
                        passphrase?: string;
                    };
                };
            };
        };
        responses: {
            /** @description SshServer registered (no credentials in the response). */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        name: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        lastConnectedAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error, or workspaceId missing for a workspace scope. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Duplicate server name, or the sealing key is unavailable. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteSsh-serversByServerId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                serverId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such server owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postSsh-serversByServerIdTest-connection": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                serverId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Connected and authenticated; the observed host-key fingerprint. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        hostKeyFingerprint: string;
                    };
                };
            };
            /** @description Could not connect (unreachable, auth failed, or timed out). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such server owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The server's host key changed, or the sealing key is unavailable. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getServer-install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of ServerInstall (never includes credentials or the bearer). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        /** @enum {string} */
                        status: "provisioning" | "installed" | "failed";
                        /** @enum {string|null} */
                        step: "connect" | "preflight" | "upload" | "install" | "start" | "health" | null;
                        errorMessage: string | null;
                        installedVersion: string | null;
                        lastHealthyAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
        };
    };
    "postServer-install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    host: string;
                    port?: number;
                    username: string;
                    credentials: {
                        /** @constant */
                        authKind: "password";
                        password: string;
                    } | {
                        /** @constant */
                        authKind: "private-key";
                        privateKey: string;
                        passphrase?: string;
                    };
                };
            };
        };
        responses: {
            /** @description The provisioning row — poll GET /server-install/:installId to follow step progress. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        /** @enum {string} */
                        status: "provisioning" | "installed" | "failed";
                        /** @enum {string|null} */
                        step: "connect" | "preflight" | "upload" | "install" | "start" | "health" | null;
                        errorMessage: string | null;
                        installedVersion: string | null;
                        lastHealthyAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description No engine payload available, or the encryption key is not loaded. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getServer-installByInstallId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The install row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        /** @enum {string} */
                        status: "provisioning" | "installed" | "failed";
                        /** @enum {string|null} */
                        step: "connect" | "preflight" | "upload" | "install" | "start" | "health" | null;
                        errorMessage: string | null;
                        installedVersion: string | null;
                        lastHealthyAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Unknown install, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteServer-installByInstallId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Forgotten. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown install, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postServer-installByInstallIdReprovision": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The row, back in provisioning — poll it for step progress. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        host: string;
                        port: number;
                        username: string;
                        /** @enum {string} */
                        authKind: "password" | "private-key";
                        hostKeyFingerprint: string | null;
                        /** @enum {string} */
                        status: "provisioning" | "installed" | "failed";
                        /** @enum {string|null} */
                        step: "connect" | "preflight" | "upload" | "install" | "start" | "health" | null;
                        errorMessage: string | null;
                        installedVersion: string | null;
                        lastHealthyAt: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Unknown install, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No engine payload available, or a run is already in flight. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getServer-installByInstallIdClaude-auth": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { isSignedIn, detail } — the CLI's own verdict; never a credential. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        isSignedIn: boolean;
                        detail: string;
                    };
                };
            };
            /** @description Unknown install, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The install is not ready yet. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postServer-installByInstallIdClaude-auth": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { phase, authorizationUrl, errorMessage } — open the URL, then POST the code. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        phase: "awaiting-authorization" | "finishing" | "signed-in" | "failed";
                        authorizationUrl: string | null;
                        errorMessage: string | null;
                    };
                };
            };
            /** @description Unknown install, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The install is not ready, or the server offered no sign-in link. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postServer-installByInstallIdClaude-authCode": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            /** @description { phase, … } — poll GET /claude-auth for the final verdict. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        phase: "awaiting-authorization" | "finishing" | "signed-in" | "failed";
                        authorizationUrl: string | null;
                        errorMessage: string | null;
                    };
                };
            };
            /** @description The code was empty. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown install, or no sign-in in progress. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getMarketplaceItems: {
        parameters: {
            query?: {
                category?: string;
                publisherTier?: "verified" | "anthropic-official" | "community";
                installState?: "installed" | "not-installed";
                searchQuery?: string;
                sortBy?: "recommended" | "name-asc" | "newest";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Annotated marketplace items surfaced at the user level. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        itemId: string;
                        /** @enum {string} */
                        kind: "skill" | "agent" | "plugin" | "mcp" | "rule";
                        skillId: string;
                        /** @enum {string} */
                        publisherTier: "verified" | "anthropic-official" | "community";
                        publisherName: string;
                        publisherUrl: string | null;
                        sourceUrl: string | null;
                        displayName: string;
                        oneLineDescription: string;
                        category: string;
                        iconName: string;
                        version: string;
                        releasedAt: string;
                        /** @enum {string} */
                        recommendedScope: "user" | "workspace";
                        /** @enum {string} */
                        scope: "user" | "workspace" | "both";
                        isOfficial: boolean;
                        pluginKey?: string;
                        mcpServerName?: string;
                        hasCloudArtifact: boolean;
                        installStatus: {
                            /** @constant */
                            kind: "not-installed";
                        } | {
                            /** @constant */
                            kind: "installed";
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            installedId: string;
                            versionInstalled: string | null;
                        };
                        /** @enum {string} */
                        minimumTier?: "basic" | "pro";
                    }[];
                };
            };
        };
    };
    postMarketplaceInstall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    itemId: string;
                };
            };
        };
        responses: {
            /** @description The installed item, discriminated by kind. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        source: "verified-catalog" | "marketplace" | "external";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "agent";
                        agentId: string;
                        slug: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                        version: string | null;
                    } | {
                        /** @constant */
                        kind: "mcp";
                        serverName: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string | null;
                    } | {
                        /** @constant */
                        kind: "rule";
                        ruleId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        version: string;
                    };
                };
            };
            /** @description The caller’s tier may not install this item. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in the catalog or not surfaced at the user level. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Already installed at user scope. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postMarketplaceUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    itemId: string;
                };
            };
        };
        responses: {
            /** @description The updated installation, discriminated by kind (skill or plugin). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        source: "verified-catalog" | "marketplace" | "external";
                        version: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                        version: string | null;
                    };
                };
            };
            /** @description Kind without in-place update, no cloud version, or hub unavailable. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in the catalog, not surfaced at the user level, OR not installed at user scope. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postMarketplaceUninstall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    itemId: string;
                };
            };
        };
        responses: {
            /** @description The removed installation, discriminated by item kind. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "skill";
                        installedSkillId: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "agent";
                        agentId: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "plugin";
                        pluginKey: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "mcp";
                        serverName: string;
                        itemId: string;
                    } | {
                        /** @constant */
                        kind: "rule";
                        ruleId: string;
                        itemId: string;
                    };
                };
            };
            /** @description The skill is system-installed; uninstall blocked. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Item not in the catalog, not surfaced at the user level, OR not installed at user scope. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getNotebookPlaybooks: {
        parameters: {
            query?: {
                workspaceId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { playbooks: PlaybookListing[] } — verified books lead; a verified id wins a collision. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        playbooks: {
                            id: string;
                            title: string;
                            oneLiner: string;
                            verified: boolean;
                        }[];
                    };
                };
            };
        };
    };
    getNotebookPlaybooksByPlaybookId: {
        parameters: {
            query?: {
                workspaceId?: string;
            };
            header?: never;
            path: {
                playbookId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Playbook (listing fields + body). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        oneLiner: string;
                        verified: boolean;
                        body: string;
                    };
                };
            };
            /** @description No such playbook on this shelf. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getNotebookDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { documents: NotebookDocument[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        documents: {
                            id: string;
                            userId: string;
                            /** @enum {string} */
                            scope: "global" | "workspace";
                            workspaceId: string | null;
                            /** @enum {string} */
                            mode: "always" | "notebook";
                            title: string;
                            body: string;
                            enabled: boolean;
                            sortOrder: number;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                    };
                };
            };
        };
    };
    postNotebookDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    scope: "global" | "workspace";
                    workspaceId?: string;
                    title: string;
                    body: string;
                    enabled?: boolean;
                };
            };
        };
        responses: {
            /** @description NotebookDocument created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        /** @enum {string} */
                        scope: "global" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        mode: "always" | "notebook";
                        title: string;
                        body: string;
                        enabled: boolean;
                        sortOrder: number;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error (scope/workspaceId pairing, title, or body). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found (or not owned by this user). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteNotebookDocumentsByDocumentId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted (no body). */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such document owned by this user (verified books included). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchNotebookDocumentsByDocumentId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    title?: string;
                    body?: string;
                    enabled?: boolean;
                };
            };
        };
        responses: {
            /** @description NotebookDocument updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        /** @enum {string} */
                        scope: "global" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        mode: "always" | "notebook";
                        title: string;
                        body: string;
                        enabled: boolean;
                        sortOrder: number;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation error (empty patch, title, or body). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such document owned by this user (verified books included). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getKnowledgeSources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { sources: SerializedKnowledgeSourceListItem[] }. */
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
                            /** @enum {string} */
                            sourceKind: "directory" | "file";
                            absolutePath: string;
                            createdAt: string;
                            updatedAt: string;
                            documentCount: number;
                            indexedDocumentCount: number;
                            failedDocumentCount: number;
                            lastIndexedAt: string | null;
                        }[];
                    };
                };
            };
        };
    };
    getMemoryEntries: {
        parameters: {
            query?: {
                kind?: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                includeArchived?: boolean;
                cursorLastMentionedAt?: string | null;
                cursorId?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { entries: SerializedMemoryEntry[], nextCursor }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entries: {
                            id: string;
                            userId: string;
                            workspaceId: string;
                            /** @enum {string} */
                            kind: "person" | "preference" | "business-fact" | "recurring-pattern" | "note";
                            title: string;
                            body: string;
                            /** @enum {string} */
                            category: "user" | "preferences" | "memory";
                            section: string;
                            sourceMessageId: string | null;
                            /** @enum {string} */
                            createdSource: "workspace-seed" | "user-manual" | "onboarding-seed" | "file-import";
                            embeddingPresent: boolean;
                            embeddingModelVersion: string | null;
                            isArchived: boolean;
                            tags: string[];
                            createdAt: string;
                            updatedAt: string;
                            lastMentionedAt: string | null;
                        }[];
                        nextCursor: {
                            lastMentionedAt: string | null;
                            id: string;
                        } | null;
                    };
                };
            };
        };
    };
    getSkillsInstalled: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description User-scope installs only (workspaceId null), each joined with its catalog definition. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        skillId: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        installedFromSource: "verified-catalog" | "marketplace" | "external";
                        versionInstalled: string;
                        /** @enum {string} */
                        installHealth: "healthy" | "missing-on-disk" | "mcp-config-drift" | "failed-install";
                        installHealthMessage: string | null;
                        installedAt: string;
                        updatedAt: string;
                        definition: {
                            skillId: string;
                            displayName: string;
                            oneLineDescription: string;
                            /** @enum {string} */
                            category: "email" | "documents" | "calendar" | "files" | "research" | "notes" | "context" | "creative" | "communication";
                            iconName: string;
                            version: string;
                            /** @enum {string} */
                            recommendedScope: "user" | "workspace";
                            isSystemInstalled: boolean;
                            settingsSchema: {
                                settingKey: string;
                                displayLabel: string;
                                description: string;
                                /** @enum {string} */
                                type: "string" | "number" | "boolean" | "string-enum";
                                defaultValue: string | number | boolean;
                                enumValues?: string[];
                                validationConstraints?: {
                                    min?: number;
                                    max?: number;
                                    minLength?: number;
                                    maxLength?: number;
                                };
                            }[];
                        } | null;
                        resolvedSettings: {
                            [key: string]: string | number | boolean;
                        };
                    }[];
                };
            };
        };
    };
    getRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All rule files (hand-written + marketplace), provenance per row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rules: {
                            ruleId: string;
                            fileName: string;
                            title: string;
                            content: string;
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            marketplace: {
                                ruleId: string;
                                version: string;
                            } | null;
                        }[];
                    };
                };
            };
        };
    };
    getCommands: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One row per command file, namespaced by subfolder. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        commands: {
                            commandName: string;
                            relativePath: string;
                            description: string | null;
                            argumentHint: string | null;
                            bodyPreview: string | null;
                            /** @enum {string} */
                            scope: "user" | "workspace";
                        }[];
                    };
                };
            };
        };
    };
    "getMcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Masked rows — header/env values never leave the backend. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        servers: {
                            serverName: string;
                            /** @enum {string} */
                            scope: "user" | "workspace";
                            /** @enum {string} */
                            transport: "stdio" | "http" | "sse";
                            commandOrUrl: string;
                            args: string[];
                            environmentKeys: string[];
                            headers: {
                                name: string;
                                hasValue: boolean;
                            }[];
                        }[];
                    };
                };
            };
        };
    };
    "postMcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    serverName: string;
                    /** @constant */
                    transport: "stdio";
                    command: string;
                    /** @default [] */
                    args?: string[];
                    /** @default {} */
                    environment?: {
                        [key: string]: string;
                    };
                } | {
                    serverName: string;
                    /** @constant */
                    transport: "http";
                    url: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                } | {
                    serverName: string;
                    /** @constant */
                    transport: "sse";
                    url: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description The added server, masked. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        serverName: string;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        /** @enum {string} */
                        transport: "stdio" | "http" | "sse";
                        commandOrUrl: string;
                        args: string[];
                        environmentKeys: string[];
                        headers: {
                            name: string;
                            hasValue: boolean;
                        }[];
                    };
                };
            };
            /** @description Invalid body, or a non-https remote URL (loopback exempt). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description A server with that name already exists in the global config. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "deleteMcp-serversByServerName": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                serverName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No server with that name in the global config. */
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
                content: {
                    "application/json": {
                        id: string;
                        providerApprovalId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        parentMessageId: string;
                        toolUseId: string;
                        toolName: string;
                        /** @enum {string} */
                        actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        toolInput?: unknown;
                        /** @enum {string} */
                        status: "pending" | "resolved";
                        /** @enum {string|null} */
                        resolutionKind: "approved" | "denied" | "timed-out" | "cancelled" | null;
                        autoApprovedByRuleId: string | null;
                        requestedAt: string;
                        resolvedAt: string | null;
                    }[];
                };
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
                content: {
                    "application/json": {
                        id: string;
                        providerApprovalId: string;
                        workspaceId: string | null;
                        sessionId: string;
                        parentMessageId: string;
                        toolUseId: string;
                        toolName: string;
                        /** @enum {string} */
                        actionKind: "email-send" | "file-write" | "file-edit" | "file-delete" | "calendar-write" | "shell-command" | "external-action" | "memory-write" | "other";
                        toolInput?: unknown;
                        /** @enum {string} */
                        status: "pending" | "resolved";
                        /** @enum {string|null} */
                        resolutionKind: "approved" | "denied" | "timed-out" | "cancelled" | null;
                        autoApprovedByRuleId: string | null;
                        requestedAt: string;
                        resolvedAt: string | null;
                    };
                };
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
    getUsersMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The user record. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        displayName: string;
                        emailAddress: string | null;
                        locale: string;
                        timezone: string;
                        hasCompletedOnboarding: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
        };
    };
    patchUsersMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    displayName?: string;
                    /** Format: email */
                    emailAddress?: string | null;
                    locale?: string;
                    timezone?: string;
                };
            };
        };
        responses: {
            /** @description The updated user record. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        displayName: string;
                        emailAddress: string | null;
                        locale: string;
                        timezone: string;
                        hasCompletedOnboarding: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            /** @description Validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description User not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getUsersMePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The resolved preferences object. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        theme: "light" | "dark" | "system";
                        defaultWorkspaceId: string | null;
                        chatStreamingEnabled: boolean;
                        reducedMotion: boolean;
                    };
                };
            };
        };
    };
    patchUsersMePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    theme?: "light" | "dark" | "system";
                    defaultWorkspaceId?: string;
                    chatStreamingEnabled?: boolean;
                    reducedMotion?: boolean;
                };
            };
        };
        responses: {
            /** @description The resolved preferences after the update. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        theme: "light" | "dark" | "system";
                        defaultWorkspaceId: string | null;
                        chatStreamingEnabled: boolean;
                        reducedMotion: boolean;
                    };
                };
            };
            /** @description Validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postOnboardingStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The in-progress OnboardingRun. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        currentStepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                        completedSteps: ("welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule")[];
                        collectedData: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        status: "in-progress" | "completed" | "abandoned";
                        startedAt: string;
                        lastActivityAt: string;
                        completedAt: string | null;
                    };
                };
            };
        };
    };
    postOnboardingRestart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A fresh OnboardingRun. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        currentStepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                        completedSteps: ("welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule")[];
                        collectedData: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        status: "in-progress" | "completed" | "abandoned";
                        startedAt: string;
                        lastActivityAt: string;
                        completedAt: string | null;
                    };
                };
            };
        };
    };
    "getOnboardingStatusNeeds-onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { needsOnboarding, inProgressRunId }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        needsOnboarding: boolean;
                        inProgressRunId: string | null;
                    };
                };
            };
        };
    };
    getOnboardingByRunId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The OnboardingRunStatusSnapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        run: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            /** @enum {string} */
                            currentStepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                            completedSteps: ("welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule")[];
                            collectedData: {
                                [key: string]: unknown;
                            };
                            /** @enum {string} */
                            status: "in-progress" | "completed" | "abandoned";
                            startedAt: string;
                            lastActivityAt: string;
                            completedAt: string | null;
                        };
                        currentStep: {
                            /** @enum {string} */
                            stepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                            order: number;
                            isSkippable: boolean;
                            displayLabel: string;
                            oneLineDescription: string;
                        };
                        totalSteps: number;
                        completedStepCount: number;
                        collectedData: {
                            welcome?: {
                                /** @constant */
                                acknowledged: true;
                            };
                            profile?: {
                                displayName: string;
                                locale: string;
                                timezone: string;
                            };
                            nameWorkspace?: {
                                name: string;
                            };
                            identitySeed?: {
                                aboutYouParagraph: string;
                                workspaceContextAnswer: string;
                                workingStyleAnswer?: string;
                            };
                            installSuggestedSkills?: {
                                skillIdsToInstall: string[];
                                skillSettingsBySkillId?: {
                                    [key: string]: {
                                        [key: string]: unknown;
                                    };
                                };
                            };
                            optionalChannel?: {
                                /** @constant */
                                kind: "skipped";
                            } | {
                                /** @constant */
                                kind: "connect";
                                /** @constant */
                                channelKind: "telegram";
                                displayName: string;
                                botCredentials: {
                                    botToken: string;
                                };
                                initialAllowedSenderId?: string;
                            };
                            optionalSchedule?: {
                                /** @constant */
                                kind: "skipped";
                            } | {
                                /** @constant */
                                kind: "create-morning-briefing";
                                timezone?: string;
                                fireHour: number;
                                channelId?: string;
                            };
                            workspacePath?: string;
                            channelId?: string;
                        };
                        suggestedSkills?: {
                            defaultCheckedSkillIds: string[];
                            optionalSkillIds: string[];
                        };
                    };
                };
            };
            /** @description Run not found or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postOnboardingByRunIdSubmit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    stepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                    stepInput?: unknown;
                };
            };
        };
        responses: {
            /** @description The advanced OnboardingRun. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        workspaceId: string | null;
                        /** @enum {string} */
                        currentStepKind: "welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule";
                        completedSteps: ("welcome" | "profile" | "name-workspace" | "identity-seed" | "install-suggested-skills" | "optional-channel" | "optional-schedule")[];
                        collectedData: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        status: "in-progress" | "completed" | "abandoned";
                        startedAt: string;
                        lastActivityAt: string;
                        completedAt: string | null;
                    };
                };
            };
            /** @description Validation error or step-kind mismatch. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Run not found or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Run already completed. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getProviders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One entry per registered provider. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        providerId: "claude" | "codex" | "gemini" | "cursor";
                        isInstalled: boolean;
                        isAuthenticated: boolean;
                        authenticatedAccountLabel: string | null;
                        /** @enum {string|null} */
                        authenticationMethod: "oauth" | "api-key" | null;
                        inactiveReason: string | null;
                    }[];
                };
            };
        };
    };
    getProvidersByProviderIdAuth: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                providerId: "claude" | "codex" | "gemini" | "cursor";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The provider status (status-as-data: returns isInstalled false rather than throwing). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        providerId: "claude" | "codex" | "gemini" | "cursor";
                        isInstalled: boolean;
                        isAuthenticated: boolean;
                        authenticatedAccountLabel: string | null;
                        /** @enum {string|null} */
                        authenticationMethod: "oauth" | "api-key" | null;
                        inactiveReason: string | null;
                    };
                };
            };
            /** @description Unsupported providerId. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getProvidersByProviderIdModels: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                providerId: "claude" | "codex" | "gemini" | "cursor";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The model roster: discovered from the engine when a turn has run, else the curated static floor. Context windows derived per model. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        models: {
                            id: string;
                            label: string;
                            description: string | null;
                            supportedEffortLevels: ("low" | "medium" | "high" | "xhigh" | "max")[] | null;
                            contextWindowTokens: number;
                        }[];
                        isDiscovered: boolean;
                    };
                };
            };
            /** @description Unsupported providerId. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getProvidersByProviderIdSkills: {
        parameters: {
            query?: {
                workspacePath?: string;
            };
            header?: never;
            path: {
                providerId: "claude" | "codex" | "gemini" | "cursor";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The skills the runtime sees installed on disk. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        providerId: "claude" | "codex" | "gemini" | "cursor";
                        /** @enum {string} */
                        scope: "user" | "workspace" | "plugin";
                        skillName: string;
                        displayDescription: string | null;
                        installLocation: string;
                        invocationSyntax: string;
                    }[];
                };
            };
            /** @description Unsupported providerId. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAgents: {
        parameters: {
            query?: {
                workspaceId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of agents, newest first (user-scope ∪ the workspace when workspaceId is given; user-scope only when omitted — the global surface). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                    }[];
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
    postAgents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    slug: string;
                    name: string;
                    description: string;
                    prompt: string;
                    /** @enum {string} */
                    scope: "user" | "workspace";
                    workspaceId?: string;
                    icon?: string;
                    model?: string;
                    /** @enum {string} */
                    effort?: "low" | "medium" | "high" | "xhigh" | "max";
                    /** @enum {string} */
                    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
                    background?: boolean;
                    allowedTools?: string[];
                    disallowedTools?: string[];
                    skillIds?: string[];
                };
            };
        };
        responses: {
            /** @description The created agent (with its preloaded skill ids). */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        skillIds: string[];
                    };
                };
            };
            /** @description Invalid body, or workspaceId missing for a workspace-scoped agent. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found (workspace-scoped create). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description An agent with that slug already exists at the requested scope. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAgentsCurated: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The compiled-in curated agent catalog. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        slug: string;
                        name: string;
                        description: string;
                        iconName: string;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        skillIds: string[];
                        /** @enum {string} */
                        recommendedScope: "user" | "workspace";
                    }[];
                };
            };
        };
    };
    postAgentsCuratedInstall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    slug: string;
                    /** @enum {string} */
                    scope: "user" | "workspace";
                    workspaceId?: string;
                };
            };
        };
        responses: {
            /** @description The installed agent (with its preloaded skill ids). */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        skillIds: string[];
                    };
                };
            };
            /** @description workspaceId missing for a workspace-scoped install. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Curated agent slug not found, or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description An agent with that slug already exists at the requested scope. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAgentsBySlug: {
        parameters: {
            query?: {
                workspaceId?: string;
            };
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The agent (with its preloaded skill ids). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        skillIds: string[];
                    };
                };
            };
            /** @description Agent or workspace not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteAgentsByAgentId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Soft-deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Agent not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchAgentsByAgentId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    slug?: string;
                    name?: string;
                    description?: string;
                    prompt?: string;
                    icon?: string | null;
                    model?: string | null;
                    /** @enum {string|null} */
                    effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
                    /** @enum {string|null} */
                    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                    background?: boolean;
                    allowedTools?: string[] | null;
                    disallowedTools?: string[] | null;
                    enabled?: boolean;
                    skillIds?: string[];
                };
            };
        };
        responses: {
            /** @description The updated agent. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        skillIds: string[];
                    };
                };
            };
            /** @description Agent not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Renamed slug collides with an existing agent at this scope. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postAgentsByAgentIdEnable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    enabled: boolean;
                };
            };
        };
        responses: {
            /** @description The updated agent. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        description: string;
                        icon: string | null;
                        prompt: string;
                        model: string | null;
                        /** @enum {string|null} */
                        effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
                        /** @enum {string|null} */
                        permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | null;
                        background: boolean;
                        allowedTools: string[] | null;
                        disallowedTools: string[] | null;
                        /** @enum {string} */
                        scope: "user" | "workspace";
                        workspaceId: string | null;
                        /** @enum {string} */
                        source: "vynel" | "user" | "community";
                        /** @enum {string} */
                        trustTier: "verified" | "anthropic-official" | "community";
                        enabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        skillIds: string[];
                    };
                };
            };
            /** @description Agent not found OR owned by another user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getRootContinuing: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { rootSessionId, currentSdkSessionId } — nulls when no global root exists yet. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rootSessionId: string | null;
                        currentSdkSessionId: string | null;
                    };
                };
            };
        };
    };
    getRootTranscript: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { messages, toolCallsByMessageId } — the ordered message history + persisted tool calls keyed by message (empty until the first turn). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        messages: {
                            id: string;
                            /** @enum {string} */
                            role: "user" | "assistant" | "system";
                            body: string;
                            /** @enum {string|null} */
                            sourceKind: "user" | "global-root" | "workspace-manager" | "agent" | null;
                            sourceLabel: string | null;
                            partialSessionId: string | null;
                            /** @enum {string|null} */
                            originChannel: "voice" | "telegram" | "discord" | "zoom" | null;
                            attachedImagesMetadata: {
                                filename: string;
                                mimeType: string;
                                sizeBytes: number;
                            }[] | null;
                        }[];
                        toolCallsByMessageId: {
                            [key: string]: {
                                id: string;
                                parentMessageId: string;
                                toolUseId: string;
                                toolName: string;
                                toolInput?: unknown;
                                toolOutput?: unknown;
                                /** @enum {string} */
                                status: "started" | "completed" | "failed" | "denied" | "cancelled";
                                /** @enum {string|null} */
                                approvalStatus: "approved" | "denied" | "timed-out" | "cancelled" | null;
                                isErrorResult: boolean;
                                subagentNarrative?: string | null;
                                subagentToolCalls?: {
                                    toolUseId: string;
                                    toolName: string;
                                    toolInput?: unknown;
                                    /** @enum {string} */
                                    status: "started" | "completed" | "failed";
                                    startedAt: string;
                                    completedAt: string | null;
                                }[] | null;
                                delegation?: {
                                    jobId: string;
                                    partialSessionId: string | null;
                                    /** @enum {string} */
                                    status: "pending" | "claimed" | "completed" | "failed";
                                    deliveredTo: string | null;
                                    taskLabel: string | null;
                                    reportedAt: string | null;
                                    completedAt: string | null;
                                } | null;
                                startedAt: string;
                                completedAt: string | null;
                            }[];
                        };
                    };
                };
            };
        };
    };
    getRootTraceByPartialSessionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                partialSessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { partialSessionId, entries } — the attributed chain; empty entries when unknown/not-owned. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        partialSessionId: string;
                        /** @enum {string|null} */
                        status: "pending" | "claimed" | "completed" | "failed" | null;
                        spawnedTargetSession: {
                            sessionId: string;
                            name: string;
                        } | null;
                        entries: {
                            id: string;
                            /** @enum {string} */
                            role: "user" | "assistant" | "system";
                            /** @enum {string|null} */
                            sourceKind: "user" | "global-root" | "workspace-manager" | "agent" | null;
                            sourceLabel: string | null;
                            body: string;
                            sessionId: string;
                            /** @enum {string} */
                            scope: "global" | "workspace";
                            toolCalls: {
                                id: string;
                                parentMessageId: string;
                                toolUseId: string;
                                toolName: string;
                                toolInput?: unknown;
                                toolOutput?: unknown;
                                /** @enum {string} */
                                status: "started" | "completed" | "failed" | "denied" | "cancelled";
                                /** @enum {string|null} */
                                approvalStatus: "approved" | "denied" | "timed-out" | "cancelled" | null;
                                isErrorResult: boolean;
                                subagentNarrative?: string | null;
                                subagentToolCalls?: {
                                    toolUseId: string;
                                    toolName: string;
                                    toolInput?: unknown;
                                    /** @enum {string} */
                                    status: "started" | "completed" | "failed";
                                    startedAt: string;
                                    completedAt: string | null;
                                }[] | null;
                                delegation?: {
                                    jobId: string;
                                    partialSessionId: string | null;
                                    /** @enum {string} */
                                    status: "pending" | "claimed" | "completed" | "failed";
                                    deliveredTo: string | null;
                                    taskLabel: string | null;
                                    reportedAt: string | null;
                                    completedAt: string | null;
                                } | null;
                                startedAt: string;
                                completedAt: string | null;
                            }[];
                            createdAt: string;
                        }[];
                    };
                };
            };
        };
    };
    getRootTraceByPartialSessionIdStream: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                partialSessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream of the routed turn’s events; ends with turn-stream-ended. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown trace key, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getRootSessionsBySessionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { session, messages, toolCallsByMessageId } — the full session detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        session: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            providerId: string;
                            model: string | null;
                            title: string;
                            /** @enum {string} */
                            visibility: "listed" | "hidden";
                            /** @enum {string} */
                            scope: "global" | "workspace" | "agent";
                            isArchived: boolean;
                            deletedAt: string | null;
                            totalMessageCount: number;
                            totalInputTokens: number;
                            totalOutputTokens: number;
                            startedAt: string;
                            lastMessageAt: string;
                            updatedAt: string;
                        };
                        messages: {
                            id: string;
                            sessionId: string;
                            /** @enum {string} */
                            role: "user" | "assistant" | "system";
                            body: string;
                            /** @enum {string|null} */
                            sourceKind: "user" | "global-root" | "workspace-manager" | "agent" | null;
                            sourceLabel: string | null;
                            /** @enum {string|null} */
                            originChannel: "voice" | "telegram" | "discord" | "zoom" | null;
                            partialSessionId: string | null;
                            delegationTaskLabel?: string | null;
                            thinkingBody: string | null;
                            inputTokens: number | null;
                            outputTokens: number | null;
                            attachedImagesMetadata: {
                                filename: string;
                                mimeType: string;
                                sizeBytes: number;
                            }[] | null;
                            errorCode: string | null;
                            errorMessage: string | null;
                            startedAt: string;
                            completedAt: string | null;
                            createdAt: string;
                        }[];
                        toolCallsByMessageId: {
                            [key: string]: {
                                id: string;
                                parentMessageId: string;
                                toolUseId: string;
                                toolName: string;
                                toolInput?: unknown;
                                toolOutput?: unknown;
                                /** @enum {string} */
                                status: "started" | "completed" | "failed" | "denied" | "cancelled";
                                /** @enum {string|null} */
                                approvalStatus: "approved" | "denied" | "timed-out" | "cancelled" | null;
                                isErrorResult: boolean;
                                subagentNarrative?: string | null;
                                subagentToolCalls?: {
                                    toolUseId: string;
                                    toolName: string;
                                    toolInput?: unknown;
                                    /** @enum {string} */
                                    status: "started" | "completed" | "failed";
                                    startedAt: string;
                                    completedAt: string | null;
                                }[] | null;
                                delegation?: {
                                    jobId: string;
                                    partialSessionId: string | null;
                                    /** @enum {string} */
                                    status: "pending" | "claimed" | "completed" | "failed";
                                    deliveredTo: string | null;
                                    taskLabel: string | null;
                                    reportedAt: string | null;
                                    completedAt: string | null;
                                } | null;
                                startedAt: string;
                                completedAt: string | null;
                            }[];
                        };
                    };
                };
            };
            /** @description No such session, or not owned by the caller. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getRootDelegations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { delegations: [{ partialSessionId, workspaceName, sessionName, taskLabel, status }] } — empty when idle. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        delegations: {
                            partialSessionId: string | null;
                            workspaceId: string | null;
                            workspaceName: string;
                            targetPrimarySessionId: string | null;
                            sessionName: string | null;
                            taskLabel: string;
                            /** @enum {string} */
                            status: "pending" | "claimed";
                        }[];
                    };
                };
            };
        };
    };
    postRootDelegationsByPartialSessionIdStop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                partialSessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { result: 'stopped' | 'stopping' | 'already-finished' } */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        result: "stopped" | "stopping" | "already-finished";
                    };
                };
            };
            /** @description Unknown delegation, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postRootTurn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    userMessageText: string;
                    attachedImages?: {
                        filename: string;
                        /** @enum {string} */
                        mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf" | "text/plain" | "text/markdown" | "text/csv" | "text/html" | "application/json" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                        base64Data: string;
                    }[];
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                    /** @enum {string} */
                    mode?: "ask" | "auto" | "bypass";
                    voice?: boolean;
                };
            };
        };
        responses: {
            /** @description SSE stream of normalized session events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postRootTurnInterrupt: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { interrupted } — false when no global-root session exists yet. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        interrupted: boolean;
                    };
                };
            };
        };
    };
    getRoutingWorkspaces: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of { id, name } routing targets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                    }[];
                };
            };
        };
    };
    postRoutingDelegate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    targetWorkspaceId: string;
                    task: string;
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                };
            };
        };
        responses: {
            /** @description A queued acknowledgement: { status: 'enqueued', jobId, workspaceName }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "enqueued";
                        jobId: string;
                        workspaceName: string;
                    };
                };
            };
            /** @description Routing is only available during an active global-root turn. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target workspace not found or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postRoutingDelegate-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    targetSessionId: string;
                    task: string;
                    workspaceId?: string;
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                };
            };
        };
        responses: {
            /** @description A queued acknowledgement: { status: 'enqueued', jobId, sessionName }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "enqueued";
                        jobId: string;
                        sessionName: string;
                    };
                };
            };
            /** @description Routing is only available during an active creator conversation. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target session (or the given workspace) not found, not owned, or not a spawned session. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postRoutingReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    report: string;
                };
            };
        };
        responses: {
            /** @description A queued acknowledgement: { status: 'enqueued', jobId }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "enqueued";
                        jobId: string;
                    };
                };
            };
            /** @description This turn has no requester (interactive chats, schedule fires, the global root). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The calling session could not be resolved. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getRoutingChannels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of { id, name, kind } channel targets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        /** @enum {string} */
                        kind: "telegram" | "discord" | "zoom";
                    }[];
                };
            };
        };
    };
    "postRoutingSend-to-channel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    channelId: string;
                    message: string;
                };
            };
        };
        responses: {
            /** @description A queued acknowledgement: { status: 'sent', channelId }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "sent";
                        channelId: string;
                    };
                };
            };
            /** @description The channel is disabled or has no allowed recipient. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Channel not found or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postRoutingReply-to-channel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    message: string;
                };
            };
        };
        responses: {
            /** @description A queued acknowledgement: { status: 'sent', deliveredTo }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "sent";
                        deliveredTo: string;
                    };
                };
            };
            /** @description This turn did not arrive via a channel, or the channel was disabled meanwhile. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Channel not found or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "getRoutingBackground-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of background runs with status, target, and a result preview. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        jobId: string;
                        /** @enum {string} */
                        status: "queued" | "running" | "completed" | "failed";
                        target: string;
                        taskLabel: string;
                        partialSessionId: string | null;
                        enqueuedAt: string;
                        finishedAt: string | null;
                        resultPreview: string | null;
                        errorMessage: string | null;
                    }[];
                };
            };
        };
    };
    "getRoutingBackground-runsByJobId": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run, with its complete result and the task as handed off. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        jobId: string;
                        /** @enum {string} */
                        status: "queued" | "running" | "completed" | "failed";
                        target: string;
                        taskLabel: string;
                        partialSessionId: string | null;
                        enqueuedAt: string;
                        finishedAt: string | null;
                        errorMessage: string | null;
                        result: string | null;
                        taskText: string;
                    };
                };
            };
            /** @description Unknown run, or not owned by this user. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postRoutingMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    to: string;
                    body: string;
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                };
            };
        };
        responses: {
            /** @description { status: 'enqueued', jobId, deliveredTo, kind }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "enqueued";
                        jobId: string;
                        deliveredTo: string;
                        /** @enum {string} */
                        kind: "task" | "report";
                    };
                };
            };
            /** @description Bad destination, or no requester on this turn. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Target workspace or session not found, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getActivityStream: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream of SessionActivityEvents (turn lifecycle + tool steps + approval bells). Long-lived; ends only when the client disconnects. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postVoiceSpeak: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    text: string;
                };
            };
        };
        responses: {
            /** @description { spoken: true } — or { spoken: false, reason } if voice output isn't available. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        spoken: boolean;
                        reason?: string;
                    };
                };
            };
        };
    };
    getDashboardOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { workspaces, recentSessions, upcomingSchedules, openTasks, recentlyCompletedTasks }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        workspaces: {
                            id: string;
                            userId: string;
                            name: string;
                            managerName: string | null;
                            /** @enum {string} */
                            kind: "small-business" | "personal" | "project" | "custom";
                            path: string;
                            isArchived: boolean;
                            continueEnabled: boolean;
                            createdAt: string;
                            updatedAt: string;
                            lastAccessedAt: string;
                        }[];
                        recentSessions: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            providerId: string;
                            model: string | null;
                            title: string;
                            /** @enum {string} */
                            visibility: "listed" | "hidden";
                            /** @enum {string} */
                            scope: "global" | "workspace" | "agent";
                            isArchived: boolean;
                            deletedAt: string | null;
                            totalMessageCount: number;
                            totalInputTokens: number;
                            totalOutputTokens: number;
                            startedAt: string;
                            lastMessageAt: string;
                            updatedAt: string;
                            lastMessagePreview: string | null;
                        }[];
                        upcomingSchedules: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            /** @enum {string} */
                            templateKind: "morning-briefing" | "weekly-summary" | "email-watch" | "custom" | "reminder";
                            /** @enum {string} */
                            scheduleKind: "recurring" | "one-time";
                            displayName: string;
                            cronExpression: string | null;
                            timezone: string;
                            promptTemplate: string;
                            /** @enum {string} */
                            destinationKind: "chat-only" | "chat-and-channel";
                            channelId: string | null;
                            catchUpOnMiss: boolean;
                            isEnabled: boolean;
                            approvalTimeoutMsOverride: number | null;
                            lastFiredAt: string | null;
                            nextScheduledFireAt: string | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                        openTasks: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            title: string;
                            detail: string | null;
                            /** @enum {string} */
                            status: "open" | "in-progress" | "done";
                            /** @enum {string} */
                            source: "assistant" | "user";
                            sessionId: string | null;
                            planId: string | null;
                            completedAt: string | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                        recentlyCompletedTasks: {
                            id: string;
                            userId: string;
                            workspaceId: string | null;
                            title: string;
                            detail: string | null;
                            /** @enum {string} */
                            status: "open" | "in-progress" | "done";
                            /** @enum {string} */
                            source: "assistant" | "user";
                            sessionId: string | null;
                            planId: string | null;
                            completedAt: string | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                    };
                };
            };
        };
    };
    getDashboardUsage: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { rows: [{ day, model, providerId, inputTokens, outputTokens, assistantMessageCount }] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rows: {
                            day: string;
                            model: string | null;
                            providerId: string;
                            inputTokens: number;
                            outputTokens: number;
                            assistantMessageCount: number;
                        }[];
                    };
                };
            };
        };
    };
    getSessionsOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of session entries (chain segments nested), sorted by last use. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        sessionId: string;
                        /** @enum {string} */
                        scope: "global" | "workspace" | "agent" | "spawned";
                        workspaceId: string | null;
                        workspaceName: string | null;
                        title: string;
                        model: string | null;
                        contextTokens: number | null;
                        contextWindow: number;
                        lastMessageAt: string;
                        segments: {
                            sessionId: string;
                            title: string;
                            startedAt: string;
                            lastMessageAt: string;
                            contextTokens: number | null;
                            continuedFromSessionId: string | null;
                            isCurrent: boolean;
                        }[];
                    }[];
                };
            };
        };
    };
    postSessionsSpawned: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    name: string;
                    purpose: string;
                    workspaceId?: string;
                };
            };
        };
        responses: {
            /** @description { status: 'created', sessionId, name } */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "created";
                        sessionId: string;
                        name: string;
                    };
                };
            };
            /** @description workspaceId given but the workspace is unknown or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSessionsBySessionIdStream: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE stream of the session’s live events; turn-stream-ended per turn. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown session, or not owned. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    postSessionsBySessionIdTurn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    userMessageText: string;
                    model?: string;
                    /** @enum {string} */
                    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
                    /** @enum {string} */
                    mode?: "ask" | "auto" | "bypass";
                };
            };
        };
        responses: {
            /** @description SSE stream of the turn’s ChatTurnEvents; a `turn-queued` sentinel precedes a turn parked behind a running task; `turn-stream-ended` closes the stream. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unknown session, not owned, or not a spawned session. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getHubSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The HubLinkStatus union. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "not-configured";
                    } | {
                        /** @constant */
                        kind: "signed-out";
                    } | {
                        /** @constant */
                        kind: "signed-in";
                        email: string;
                        displayName: string;
                        checkedAt: string;
                        tier: string | null;
                        features: string[] | null;
                    } | {
                        /** @constant */
                        kind: "locked";
                        message: string;
                    } | {
                        /** @constant */
                        kind: "offline";
                        email: string | null;
                        displayName: string | null;
                        tier: string | null;
                        features: string[];
                    };
                };
            };
        };
    };
    "postHubSign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description The resulting HubLinkStatus (signed-in on success). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "not-configured";
                    } | {
                        /** @constant */
                        kind: "signed-out";
                    } | {
                        /** @constant */
                        kind: "signed-in";
                        email: string;
                        displayName: string;
                        checkedAt: string;
                        tier: string | null;
                        features: string[] | null;
                    } | {
                        /** @constant */
                        kind: "locked";
                        message: string;
                    } | {
                        /** @constant */
                        kind: "offline";
                        email: string | null;
                        displayName: string | null;
                        tier: string | null;
                        features: string[];
                    };
                };
            };
            /** @description Wrong email or password. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Account disabled. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "postHubSign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The resulting HubLinkStatus (signed-out). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "not-configured";
                    } | {
                        /** @constant */
                        kind: "signed-out";
                    } | {
                        /** @constant */
                        kind: "signed-in";
                        email: string;
                        displayName: string;
                        checkedAt: string;
                        tier: string | null;
                        features: string[] | null;
                    } | {
                        /** @constant */
                        kind: "locked";
                        message: string;
                    } | {
                        /** @constant */
                        kind: "offline";
                        email: string | null;
                        displayName: string | null;
                        tier: string | null;
                        features: string[];
                    };
                };
            };
        };
    };
    getHubDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { devices: HubDeviceView[] }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        devices: {
                            id: string;
                            deviceName: string;
                            devicePlatform: string;
                            appVersion: string;
                            lastUsedAt: string;
                            expiresAt: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteHubDevicesByDeviceId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description { revoked: true }. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        revoked: true;
                    };
                };
            };
            /** @description Device not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspaces: {
        parameters: {
            query?: {
                includeArchived?: boolean;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Array of workspaces. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
                    }[];
                };
            };
        };
    };
    postWorkspaces: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    kind?: "small-business" | "personal" | "project" | "custom";
                    directory: string;
                };
            };
        };
        responses: {
            /** @description Workspace created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
                    };
                };
            };
            /** @description Directory not found, not a directory, or not writable. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description This directory is already a workspace. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesDirectories: {
        parameters: {
            query?: {
                path?: string;
                includeFiles?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A directory listing (path, parent, child directories). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        path: string;
                        parent: string | null;
                        entries: {
                            name: string;
                            path: string;
                        }[];
                        files?: {
                            name: string;
                            path: string;
                        }[];
                        drives: string[];
                    };
                };
            };
            /** @description Path not found, not a directory, or not readable. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getWorkspacesByWorkspaceId: {
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
            /** @description Workspace. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
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
    deleteWorkspacesByWorkspaceId: {
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
                    deleteFilesFromDisk: boolean;
                };
            };
        };
        responses: {
            /** @description Workspace deleted. */
            204: {
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
    patchWorkspacesByWorkspaceId: {
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
                    name?: string;
                    managerName?: string;
                    continueEnabled?: boolean;
                };
            };
        };
        responses: {
            /** @description Updated workspace. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
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
    postWorkspacesByWorkspaceIdArchive: {
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
            /** @description Archived workspace. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
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
    postWorkspacesByWorkspaceIdUnarchive: {
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
            /** @description Unarchived workspace. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        userId: string;
                        name: string;
                        managerName: string | null;
                        /** @enum {string} */
                        kind: "small-business" | "personal" | "project" | "custom";
                        path: string;
                        isArchived: boolean;
                        continueEnabled: boolean;
                        createdAt: string;
                        updatedAt: string;
                        lastAccessedAt: string;
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
