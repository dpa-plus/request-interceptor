# Request Interceptor - Learning Guide

A friendly walkthrough for Java developers stepping into web development, TypeScript, and HTTP proxies.

---

## 1. What Are HTTP Requests? (The Basics)

Think of the internet like a postal system. Every time your browser loads a page or your code calls an API, it's sending a **letter** (a request) to a **mailroom** (a server), and the mailroom sends back a **reply** (a response).

### Requests and Responses

**A request** is your app saying: "Hey server, I need something." It includes:
- **Where** to send it (the URL, like a mailing address)
- **What you want** (the HTTP method, like the type of form you're filing)
- **Extra info** (headers and maybe a body)

**A response** is the server saying: "Got it, here's what happened." It includes:
- **A status code** (did it work? did it fail?)
- **Headers** (metadata about the response)
- **A body** (the actual data you asked for)

### HTTP Methods (The Verbs)

In Java, you have methods on objects. HTTP has methods too, but they describe *what you want to do* with a resource:

| Method   | What It Does  | Real-World Analogy                                      |
|----------|---------------|---------------------------------------------------------|
| `GET`    | Read data     | Looking up a book at the library. You don't change anything, you just read. |
| `POST`   | Create data   | Filling out a form and submitting it. You're creating a new record. |
| `PUT`    | Update data   | Erasing a whiteboard and rewriting the whole thing. Full replacement. |
| `PATCH`  | Partial update| Crossing out one line on the whiteboard and writing a new one. |
| `DELETE` | Remove data   | Throwing a file in the shredder. It's gone. |

Most of what you'll see in this project is `POST` -- because AI API calls send a prompt (the body) and get a completion back.

### Status Codes (The Report Card)

When the server responds, it gives you a number that tells you how things went:

| Code  | Meaning             | Translation                              |
|-------|---------------------|------------------------------------------|
| `200` | OK                  | "Here you go, everything worked."        |
| `201` | Created             | "Done, I made the new thing you asked for." |
| `400` | Bad Request         | "I don't understand what you sent me."   |
| `401` | Unauthorized        | "Who are you? Show me your credentials." |
| `403` | Forbidden           | "I know who you are, but you can't do that." |
| `404` | Not Found           | "That thing you asked for doesn't exist." |
| `429` | Too Many Requests   | "Slow down, you're sending too many."    |
| `500` | Internal Server Error | "Something broke on my end, sorry."    |

Quick rule of thumb:
- **2xx** = good
- **4xx** = you messed up
- **5xx** = the server messed up

### Headers (The Envelope)

Headers are metadata that travel with every request and response. Think of them like the writing *on* the envelope -- not the letter inside, but info about the letter.

Common ones you'll see:

```
Content-Type: application/json       -- "The body is JSON data"
Authorization: Bearer sk-abc123...   -- "Here's my API key"
User-Agent: Mozilla/5.0...           -- "I'm a Chrome browser" (or whatever is sending the request)
```

In Java terms, headers are like a `Map<String, String>` that rides along with every HTTP call.

### Body (The Letter Inside)

The body is the actual content. For AI API calls, the request body is usually JSON containing your prompt, and the response body is JSON containing the AI's answer.

Example request body for an AI call:
```json
{
  "model": "gpt-4",
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ]
}
```

Example response body:
```json
{
  "choices": [
    { "message": { "role": "assistant", "content": "The capital of France is Paris." } }
  ]
}
```

Not every request has a body. `GET` and `DELETE` usually don't. `POST` and `PUT` usually do.

---

## 2. What Is a Proxy? Why "Man in the Middle"?

### Normal Flow

When your app talks to a server, it's a direct conversation:

```
Your App  ------>  API Server (e.g., OpenAI)
          <------
```

Simple. But you can't see what's happening in that conversation unless you add logging to your app.

### With a Proxy

A proxy sits **in between** and watches everything go by:

```
Your App  ------>  Proxy (logs everything)  ------>  API Server
          <------                           <------
```

Your app thinks it's talking to the API server, but it's actually talking to the proxy. The proxy forwards everything along and keeps a copy. That's why it's called "man in the middle" -- it's the person standing between two people passing notes, reading each note before handing it off.

### Why Is This Useful?

1. **Debugging** -- See exactly what your app is sending. Is the prompt formatted wrong? Is a header missing? You can see it all.
2. **Cost monitoring** -- AI API calls cost money. See how many tokens each call uses and what it costs.
3. **Comparing requests** -- "Why did this call work but that one failed?" Open both side by side and diff them.
4. **No code changes needed** -- You don't have to add logging to your app. Just point it at the proxy instead of the real API.

### The Two Ports

This project runs two things, and they listen on two different ports (think of ports like apartment numbers in a building -- same address, different doors):

| Port   | What It Does | You Use It For |
|--------|-------------|----------------|
| `3100` | **Dashboard** (the web UI) | Open in your browser to *view* logged requests. This is the React frontend. |
| `3101` | **Proxy** (the interceptor) | Point your app here instead of the real API. This is the thing that *catches* requests. |

So instead of your app calling `https://api.openai.com/v1/chat/completions`, you'd tell it to call `http://localhost:3101/v1/chat/completions` and set a header so the proxy knows to forward it to OpenAI.

---

## 3. What We Built So Far

Here's a plain-English breakdown of every feature in the dashboard:

### Dark Mode Dashboard
The whole UI uses a dark theme. Easier on the eyes when you're staring at request logs all day.

### The Request Table
This is the main view -- a list of every request that has passed through the proxy. Each column tells you something:

| Column      | What It Means |
|-------------|---------------|
| **Method**  | The HTTP verb (`GET`, `POST`, etc.). Color-coded so you can scan quickly. |
| **Path**    | The URL path that was called (e.g., `/v1/chat/completions`). |
| **Target**  | Where the request was forwarded to (e.g., `api.openai.com`). |
| **Status**  | The response code (`200`, `404`, `500`, etc.). Green for success, red for errors. |
| **Time**    | How long the request took, start to finish. |
| **AI**      | A badge that shows if this was an AI API call (OpenAI, Anthropic, etc.). |
| **Timestamp** | When the request happened. |

### Fixed Bottom Panel (DevTools-Style)
When you click a request in the table, a panel slides up from the bottom of the screen -- just like the DevTools panel in Chrome. You can inspect the full request and response without navigating away from the list.

This means you can keep your place in the table while digging into the details. No more clicking back and forth.

### Multiple Tabs
Inside the bottom panel, you can open multiple requests in tabs. This lets you compare two (or more) requests side by side, like having multiple files open in your IDE.

### Drag-to-Resize
You can drag the top edge of the bottom panel to make it taller or shorter. Grab the bar and pull it up for more detail space, or push it down to see more of the table.

### Filter Bar
At the top of the page, there's a filter bar that lets you narrow down the request list:

- **Search** -- Type anything to filter by URL, method, or other text.
- **Type** -- Filter by request type (AI calls vs regular HTTP calls).
- **Method** -- Show only `GET`, `POST`, etc.
- **Status** -- Show only successful (2xx), client errors (4xx), server errors (5xx), etc.

### URL-Persisted Filters
When you set filters, they get saved in the browser's URL (the query string). That means:
- If you refresh the page, your filters are still there.
- You can bookmark a filtered view.
- You can share a link with specific filters already applied.

If you've ever used filters that disappeared on refresh and found it annoying -- that's what this solves.

### Scroll Position Memory
If you scroll down in the request list, click a request to inspect it, and then close the panel, you'll be right back where you were in the list. The scroll position is remembered.

### Real-Time Updates (WebSocket)
New requests appear in the table automatically -- no need to refresh the page. This uses a WebSocket connection, which is like an open phone line between the browser and the server. Instead of the browser asking "any new requests?" over and over (polling), the server just tells the browser whenever something new arrives.

In Java terms: it's like having a listener/callback that fires whenever the server has new data, instead of polling in a loop.

### Seed Script
There's a script that fills the database with fake test data so you can see what the dashboard looks like with a bunch of requests in it. Useful when you're working on the UI and don't want to manually send dozens of real requests.

---

## 4. TypeScript vs Java Quick Reference

If you know Java, you already understand most programming concepts. TypeScript is just a different way of writing them. Here's a side-by-side cheat sheet:

### Variables

```java
// Java
int count = 5;
String name = "Eli";
final double PI = 3.14;        // can't reassign
```

```typescript
// TypeScript
let count: number = 5;
const name: string = "Eli";
const PI: number = 3.14;       // can't reassign

// TypeScript also has type inference (it figures out the type for you):
let count = 5;                  // TS knows this is a number
const name = "Eli";             // TS knows this is a string
```

Key difference: TypeScript has `let` (can change) and `const` (can't change). There's no `int` vs `double` vs `float` -- it's all just `number`.

### Functions

```java
// Java
public String greet(String name) {
    return "Hello, " + name;
}
```

```typescript
// TypeScript - regular function
function greet(name: string): string {
    return "Hello, " + name;
}

// TypeScript - arrow function (you'll see these everywhere)
const greet = (name: string): string => {
    return "Hello, " + name;
};

// TypeScript - short arrow function (implicit return)
const greet = (name: string): string => "Hello, " + name;
```

Arrow functions (`=>`) are like Java lambdas, but used for everything in TypeScript, not just streams and callbacks.

### Interfaces

```java
// Java
public interface User {
    String getName();
    int getAge();
}
```

```typescript
// TypeScript
interface User {
    name: string;
    age: number;
}

// You use them to describe the shape of an object:
const user: User = {
    name: "Eli",
    age: 25
};
```

Big difference: In Java, interfaces define behavior (methods). In TypeScript, interfaces usually define *shape* (what properties an object has). More like a Java `record` or a simple data class.

### Null Handling

```java
// Java
String name = null;             // anything can be null (danger!)
// Java 14+
Optional<String> name = Optional.empty();
```

```typescript
// TypeScript
let name: string | null = null;          // explicitly allow null
let name: string | undefined = undefined; // or undefined
let name?: string;                        // shorthand for "string | undefined"

// Optional chaining (like Java's Optional, but nicer)
const len = user?.name?.length;           // returns undefined if any part is null/undefined
```

TypeScript has both `null` and `undefined`. The short version: `null` means "intentionally empty" and `undefined` means "hasn't been set." In practice, you'll mostly deal with `undefined`.

### Arrays and Collections

```java
// Java
List<String> names = new ArrayList<>();
names.add("Alice");
names.add("Bob");
Map<String, Integer> scores = new HashMap<>();
scores.put("Alice", 95);
```

```typescript
// TypeScript
const names: string[] = ["Alice", "Bob"];
names.push("Charlie");

const scores: Record<string, number> = { Alice: 95 };
// or
const scores: Map<string, number> = new Map();
scores.set("Alice", 95);
```

### Generics

```java
// Java
public <T> List<T> wrap(T item) {
    return List.of(item);
}
```

```typescript
// TypeScript -- same concept, same angle-bracket syntax
function wrap<T>(item: T): T[] {
    return [item];
}
```

Good news: if you understand Java generics, TypeScript generics will feel very familiar.

### Imports

```java
// Java
import com.example.models.User;
import java.util.List;
```

```typescript
// TypeScript
import { User } from './models/User';
import { useState, useEffect } from 'react';
```

TypeScript uses relative file paths instead of package names. The curly braces (`{ }`) mean you're importing specific named exports from that file.

### Console Output

```java
// Java
System.out.println("Hello!");
System.out.println("Count: " + count);
```

```typescript
// TypeScript
console.log("Hello!");
console.log("Count:", count);    // can pass multiple arguments
console.log(`Count: ${count}`);  // template literals (like String.format but inline)
```

### Quick Comparison Table

| Concept        | Java                          | TypeScript                        |
|----------------|-------------------------------|-----------------------------------|
| Variable       | `int x = 5;`                 | `let x: number = 5;`             |
| Constant       | `final int X = 5;`           | `const x: number = 5;`           |
| String         | `"hello" + name`             | `` `hello ${name}` ``             |
| Function       | `public int add(int a, int b)` | `const add = (a: number, b: number): number =>` |
| Interface      | `interface Foo { void bar(); }` | `interface Foo { bar: () => void; }` |
| Null check     | `if (x != null)`             | `if (x != null)` or `x?.prop`    |
| Array          | `List<String>`               | `string[]`                        |
| Map            | `Map<String, Integer>`       | `Record<string, number>`          |
| Print          | `System.out.println()`       | `console.log()`                   |
| Import         | `import com.x.Y;`           | `import { Y } from './x';`       |
| Lambda         | `(x) -> x * 2`              | `(x) => x * 2`                   |
| For-each       | `for (var item : list)`      | `for (const item of list)`       |
| Package/Module | `package com.example;`       | `export` at top of file           |

---

## 5. How to Work With This Project

### Start Everything

```bash
docker compose up --build -d
```

This builds the Docker images and starts all the containers in the background. The `-d` means "detached" (run in the background so you get your terminal back). The `--build` makes sure any code changes are picked up.

### See the Dashboard

Open your browser and go to:

```
http://localhost:3100
```

This is the React frontend where you can see all intercepted requests.

### Load Test Data

If you want to fill the dashboard with sample data to see how things look:

```bash
bash scripts/seed-test-data.sh
```

This inserts a bunch of fake requests into the database so you have something to look at.

### Send a Test Request Through the Proxy

To test the proxy manually, use `curl` to send a request through port 3101:

```bash
# Simple GET request through the proxy
curl http://localhost:3101/some/path

# POST request with JSON body (simulating an AI call)
curl -X POST http://localhost:3101/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Host: api.openai.com" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

After sending these, go to the dashboard at `http://localhost:3100` and you should see them show up in the request table.

### Check Logs

If something isn't working, check the Docker logs:

```bash
# Follow all logs (Ctrl+C to stop)
docker compose logs -f

# Just the backend logs
docker compose logs -f app

# Just the database logs
docker compose logs -f db
```

### Rebuild After Code Changes

Since the app runs in Docker, your local code changes won't take effect until you rebuild:

```bash
# Stop, rebuild, and restart
docker compose up --build -d
```

Think of it like recompiling in Java -- you change the source, you have to rebuild for it to take effect.

### Stop Everything

```bash
docker compose down
```

Add `-v` if you also want to wipe the database:

```bash
docker compose down -v
```

---

## 6. Project File Structure

Here's a map of what lives where. Think of it like a Java project's package structure, but for a full-stack web app:

```
request-interceptor/
|
|-- src/                        # Backend code (Node.js + TypeScript)
|   |-- server.ts               #   The main server entry point
|   |-- proxy.ts                #   The proxy logic (intercepts and forwards requests)
|   |-- routes/                 #   API endpoints the dashboard calls
|   |-- services/               #   Business logic (like Java service classes)
|   |-- websocket.ts            #   WebSocket setup for real-time updates
|   |-- ...
|
|-- frontend/                   # Frontend code (React + TypeScript)
|   |-- src/
|   |   |-- App.tsx             #   The root React component
|   |   |-- pages/              #   Full page components (like Java "views")
|   |   |-- components/         #   Reusable UI pieces (buttons, tables, panels)
|   |   |-- hooks/              #   Custom React hooks (reusable logic)
|   |   |-- types/              #   TypeScript type definitions
|   |   |-- ...
|   |-- package.json            #   Frontend dependencies (like pom.xml)
|   |-- ...
|
|-- prisma/
|   |-- schema.prisma           # Database schema (like JPA entities but declarative)
|   |-- migrations/             # Database migration files
|
|-- scripts/
|   |-- seed-test-data.sh       # Script to load fake test data
|   |-- ...
|
|-- compose.yml                 # Docker Compose config (defines all containers)
|-- Dockerfile                  # How to build the app's Docker image
|-- package.json                # Backend dependencies (like pom.xml for the backend)
|-- tsconfig.json               # TypeScript compiler config (like javac settings)
```

### How It Maps to Java Concepts

| This Project           | Java Equivalent                        |
|------------------------|----------------------------------------|
| `src/server.ts`        | Your `main()` method / Spring Boot app |
| `src/routes/`          | `@RestController` classes              |
| `src/services/`        | `@Service` classes                     |
| `prisma/schema.prisma` | JPA `@Entity` classes                  |
| `frontend/src/pages/`  | Thymeleaf templates / JSP pages        |
| `frontend/src/components/` | Reusable UI widgets                |
| `package.json`         | `pom.xml` or `build.gradle`            |
| `compose.yml`          | Your deployment/infrastructure config  |
| `tsconfig.json`        | Compiler flags in `pom.xml`            |

---

You've got this. Web development is a lot of new vocabulary for concepts you already understand from Java. The patterns are the same -- it's just a different language and a different ecosystem. When in doubt, think "what would the Java equivalent be?" and you'll usually find the answer maps pretty directly.
