from __future__ import annotations

import json
import re

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agent.db import fetch_all
from agent.llm.ai_model import llm
from agent.state.agent_state import AgentState
from agent.utils.progress import emit_progress
from agent.utils.tool_loop import run_tool_loop
import logging
logger = logging.getLogger("gatherly.agent-a")

# execute_readonly_select -> validate_sql -> fetchall -> return

BLOCKED_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|CALL)\b",
    re.IGNORECASE,
)

MAX_ROWS = 50

DB_SCHEMA = """
DATABASE: Gatherly (MySQL)

TABLE users (hosts)
  userId INT PK, fName VARCHAR, lName VARCHAR, email VARCHAR,
  age INT, gender VARCHAR, address VARCHAR, clothingSize VARCHAR,
  description TEXT, eligibility VARCHAR, isActive BOOLEAN,
  codeOfConductAccepted BOOLEAN, password VARCHAR, profilePic VARCHAR

TABLE admins
  adminId INT PK, fName VARCHAR, lName VARCHAR, email VARCHAR,
  password VARCHAR

TABLE clients
  clientId INT PK, fName VARCHAR, lName VARCHAR, email VARCHAR,
  phoneNb VARCHAR, age INT, gender VARCHAR, address VARCHAR,
  password VARCHAR

TABLE events
  eventId INT PK, title VARCHAR, type VARCHAR, description TEXT,
  location VARCHAR, locationLat DECIMAL, locationLng DECIMAL,
  locationPlaceName VARCHAR, venueId INT FK->venues,
  startsAt DATETIME, endsAt DATETIME,
  nbOfHosts INT, nbOfGuests DECIMAL, status VARCHAR,
  clothesId INT FK->clothing, clientId INT FK->clients,
  teamLeaderId INT FK->users, adminId INT FK->admins,
  createdAt DATETIME, updatedAt DATETIME

TABLE venues
  venueId INT PK, name VARCHAR, description TEXT, address VARCHAR,
  city VARCHAR, district VARCHAR, country VARCHAR,
  latitude DECIMAL, longitude DECIMAL, capacity INT,
  venueType VARCHAR, indoorOutdoor VARCHAR,
  parkingAvailable BOOLEAN, wheelchairAccessible BOOLEAN,
  basePriceUSD DECIMAL, publicTransportNotes TEXT,
  pickupInstructions TEXT, emergencyNotes TEXT,
  mainImage VARCHAR, interiorImage VARCHAR

TABLE event_app (event applications / host assignments)
  eventAppId INT PK, eventId INT FK->events, senderId INT FK->users,
  adminId INT FK->admins, status VARCHAR, sentAt DATETIME,
  decidedAt DATETIME, requestedRole VARCHAR, assignedRole VARCHAR,
  needsRide BOOLEAN, requestDress BOOLEAN, requestTransportation BOOLEAN,
  notes TEXT

TABLE clothing
  clothesId INT PK, clothingLabel VARCHAR, picture VARCHAR,
  description TEXT

TABLE clothing_stock
  clothingId INT PK FK->clothing, size VARCHAR PK,
  stockQty INT

TABLE transportation
  transportationId INT PK, eventId INT FK->events,
  pickupLocation VARCHAR, departureTime DATETIME, returnTime DATETIME,
  payment DECIMAL

TABLE training
  trainingId INT PK, title VARCHAR, type VARCHAR,
  description TEXT, startTime TIME, endTime TIME,
  location VARCHAR, date DATE, createdAt DATETIME

TABLE trainers
  trainingId INT PK FK->training,
  adminId INT PK FK->admins

TABLE trainees
  trainingId INT PK FK->training,
  userId INT PK FK->users

TABLE host_applications
  hostApplicationId INT PK, userId INT FK->users,
  adminId INT FK->admins,
  status ENUM('pending','accepted','rejected'),
  submittedAt DATETIME, codeOfConductAcceptedAt DATETIME,
  decidedAt DATETIME, motivation TEXT, experienceSummary TEXT,
  desiredRoles JSON, decisionNotes TEXT
""".strip()

EXAMPLE_QUERIES = """
EXAMPLE QUERIES (use these patterns):

-- Search hosts by keyword and eligibility
SELECT userId, fName, lName, email, age, gender, address,
       clothingSize, description, eligibility, isActive
  FROM users
 WHERE (fName LIKE %s OR lName LIKE %s OR description LIKE %s
        OR CONCAT(fName, ' ', lName) LIKE %s)
   AND eligibility = 'approved'
 LIMIT 20;

-- Get one host
SELECT userId, fName, lName, email, age, gender, address,
       clothingSize, description, eligibility, isActive, codeOfConductAccepted
  FROM users WHERE userId = 1;

-- Search clients
SELECT clientId, fName, lName, email, phoneNb, age, gender, address
  FROM clients
 WHERE fName LIKE '%maya%' OR lName LIKE '%maya%' OR email LIKE '%maya%'
    OR CONCAT(fName, ' ', lName) LIKE '%maya%'
 LIMIT 20;

-- Get one client
SELECT clientId, fName, lName, email, phoneNb, age, gender, address
  FROM clients WHERE clientId = 1;

-- Get event with client and venue info
SELECT e.*, c.fName AS clientFirstName, c.lName AS clientLastName,
       v.name AS venueName, v.city AS venueCity, v.capacity AS venueCapacity
  FROM events e
  LEFT JOIN clients c ON c.clientId = e.clientId
  LEFT JOIN venues v ON v.venueId = e.venueId
 WHERE e.eventId = 1;

-- Search events
SELECT eventId, title, type, location, startsAt, endsAt,
       status, nbOfGuests, nbOfHosts, clientId, venueId
  FROM events
 WHERE (title LIKE '%wedding%' OR type LIKE '%wedding%' OR location LIKE '%wedding%')
 LIMIT 20;

-- Search venues by city and capacity
SELECT venueId, name, city, district, capacity, venueType,
       indoorOutdoor, parkingAvailable, wheelchairAccessible,
       basePriceUSD, address
  FROM venues
 WHERE city = 'Byblos' AND capacity >= 400
 LIMIT 20;

-- Get host's application for an event
SELECT ea.*, e.title AS eventTitle, e.startsAt, e.location
  FROM event_app ea
  JOIN events e ON e.eventId = ea.eventId
 WHERE ea.senderId = 1 AND ea.eventId = 1
 ORDER BY ea.sentAt DESC
 LIMIT 1;

-- List accepted applications for an event
SELECT ea.eventAppId, ea.eventId, ea.senderId, ea.status,
       ea.requestedRole, ea.assignedRole,
       u.fName, u.lName, u.email
  FROM event_app ea
  JOIN users u ON u.userId = ea.senderId
 WHERE ea.eventId = 1
 LIMIT 50;

-- Event clothing with stock
SELECT e.eventId, e.title, cl.clothesId, cl.clothingLabel,
       cl.description,
       (SELECT GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ')
          FROM clothing_stock cs
         WHERE cs.clothingId = e.clothesId
       ) AS stockInfo
  FROM events e
  LEFT JOIN clothing cl ON cl.clothesId = e.clothesId
 WHERE e.eventId = 1;

-- Event transportation
SELECT * FROM transportation WHERE eventId = 1;
""".strip()


def _validate_sql(query: str) -> str | None:
    """Return an error message if the query is not allowed, else None."""
    # remove whitespace from start and end and remove ';' from the end to avoid many queries together
    normalized = query.strip().rstrip(";").strip()

    upper = normalized.upper()
    if not (upper.startswith("SELECT") or upper.startswith("SHOW")):
        return "Only SELECT and SHOW queries are allowed."

    if BLOCKED_KEYWORDS.search(normalized):
        match = BLOCKED_KEYWORDS.search(normalized)
        # return the actual text that regex matched
        return f"Blocked keyword detected: {match.group(0).upper()}"
        

    return None


def execute_readonly_select(query: str) -> tuple[list[dict], str | None]:
    """Validate and run one SELECT. Returns (rows, error_message)."""
    error = _validate_sql(query)
    if error:
        logger.info(f"[SQL] BLOCKED: {error}\n  query: {query[:200]}")
        return [], error

    clean = query.strip().rstrip(";").strip()
    upper = clean.upper()
    if not upper.startswith("SHOW"):
        if not re.search(r"LIMIT\s+\d+", clean, re.IGNORECASE):
            clean += f" LIMIT {MAX_ROWS}"
    


    logger.info(f"[SQL] RUNNING:\n{clean}")
    try:
        rows = fetch_all(clean)
        logger.info(f"[SQL] OK — {len(rows)} row(s)")
        # logger.info(f"[SQL] RESULT:\n{json.dumps(rows, default=str, indent=2)}")
        return rows, None
    except Exception as exc:
        logger.error(f"[SQL] ERROR: {exc}")
        return [], str(exc)



def _sql_system_prompt(role: str, user_id: int) -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(
        schema=DB_SCHEMA,
        examples=EXAMPLE_QUERIES,
        max_rows=MAX_ROWS,
    ).replace("{role}", role).replace("{user_id}", str(user_id))



# pydantic model that defines the expected input schema for run_sql tool
# the tool accepts an object with one field: query and it should be str
# if the llm tries to call run_sql tool without a query -> fail
class RunSQLArgs(BaseModel):
    query: str = Field(..., description="A read-only SELECT SQL query for MySQL.")



def _build_sql_tools(
    sql_executions: list[dict] | None = None,
    *,
    progress_agent: str = "sql_agent",
) -> list:
    async def run_sql(query: str) -> str:
      """Execute one or more read-only SELECTs (semicolon-separated)."""
      parts = [p.strip() for p in query.split(";") if p.strip()]
      if not parts:
          return json.dumps({"status": "error", "message": "Empty query."})

      statements = []
      for index, part in enumerate(parts):
          await emit_progress(
              "run_sql",
              "running",
              f"SQL [{index + 1}/{len(parts)}]: {part[:80]}...",
              progress_agent,
          )
          rows, error = execute_readonly_select(part)
          statements.append({
              "index": index,
              "query": part,
              "ok": error is None,
              "rows": rows,
              "error": error,
          })

          if sql_executions is not None and error is None:
              clean = part.strip().rstrip(";").strip()
              upper = clean.upper()
              if not upper.startswith("SHOW"):
                  if not re.search(r"LIMIT\s+\d+", clean, re.IGNORECASE):
                      clean += f" LIMIT {MAX_ROWS}"
              sql_executions.append({"query": clean, "rows": rows})

          

      if len(statements) == 1 and statements[0]["ok"]:
          return json.dumps(statements[0]["rows"], default=str)

      
      logger.info(f"[SQL BATCH] {len(parts)} statement(s), "
        f"ok={sum(1 for s in statements if s['ok'])}")
      
      await emit_progress(
              "run_sql",
              "completed",
              f"Statement {index + 1}/{len(parts)}: "
              + ("ok" if error is None else str(error)),
              progress_agent,
          )
      return json.dumps({"status": "batch", "statements": statements}, default=str)

    return [
        StructuredTool.from_function(
            coroutine=run_sql,
            name="run_sql",
            description="Run a read-only SELECT query against the Gatherly MySQL database.",
            args_schema=RunSQLArgs,
        ),
    ]


async def gatherly_sql_lookup(
    data_request: str,
    *,
    role: str,
    user_id: int,
    progress_agent: str = "sql_agent",
) -> dict:
    """
    Shared SQL specialist: schema + SQL generation + execution.
    Returns {"answer": str, "executions": [{"query": str, "rows": list}]}.
    """
    sql_executions: list[dict] = []
    tools = _build_sql_tools(
        sql_executions,
        progress_agent=progress_agent,
    )
    system_prompt = _sql_system_prompt(role, user_id)

    try:
        answer = await run_tool_loop(
            llm=llm,
            system_prompt=system_prompt,
            user_message=data_request,
            tools=tools,
        )
    except Exception as exc:
        return {
            "status": "error",
            "answer": f"SQL lookup failed: {exc}",
            "executions": sql_executions,
        }

    return {
        "status": "success",
        "answer": answer,
        "executions": sql_executions,
    }


SYSTEM_PROMPT_TEMPLATE = """You are the Gatherly SQL specialist.

You write and execute SELECT queries against the Gatherly MySQL database.

{schema}

{examples}

RULES:
- ONLY write SELECT or SHOW queries (prefer SELECT; use SELECT * if column names are uncertain).
- Always add LIMIT (max {max_rows}) to prevent huge result sets.
- Use the example queries above as patterns. Adapt them to the user's request.
- Use LIKE with %wildcards% for text search. Use exact match for IDs.
- Use JOINs when the user needs data from multiple tables.
- The current user's role is '{{role}}' and their user ID is {{user_id}}.
  For role='client', filter events by clientId = {{user_id}} unless they specify another.
  For role='host', the user's host record is in users with userId = {{user_id}}.
- Use one batched run_sql call when the user asks for several lookups.
  Call run_sql again only to fix a failed statement.
- Answer only from query results. If a lookup returns nothing, say so.
- Do not mention SQL, queries, or tool names in the final answer to the user.
- Present results in a clean, readable format.

MULTI-PART QUESTIONS:
- Write ALL needed SELECTs in a SINGLE run_sql call, separated by semicolons.
- Do NOT call run_sql once per sub-question across multiple turns.
- Example: SELECT ... eventId=1; SELECT ... eventId=2; SELECT ... eventId=11
- If the tool returns status "batch" and one statement has ok=false, call run_sql
  again with ONLY the fixed statement(s). Do not re-run statements that succeeded.
- Prefer SELECT * when column names are uncertain.
- Use exact IDs from the question (eventId 1, 2, 11).
"""

async def sql_agent(state: AgentState):
    task = state["remaining_task"] or state["message"]
    role = state["role"]
    user_id = state["user_id"]

    lookup = await gatherly_sql_lookup(
        task,
        role=role,
        user_id=user_id,
    )
    result = lookup.get("answer") or "SQL lookup returned no answer."

    return {
        "response": result,
        "selected_agent": "sql_agent",
        "specialist_results": state["specialist_results"] + [result],
        "completed_agents": state["completed_agents"] + ["sql_agent"],
        "remaining_task": "",
    }

