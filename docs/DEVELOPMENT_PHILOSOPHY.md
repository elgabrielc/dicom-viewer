# Development Philosophy: Why We Work This Way

<!-- Copyright (c) 2026 Divergent Health Technologies -->

This guide explains *why* professional software teams use certain practices. If you're learning software engineering, this document will help you understand the reasoning behind development workflows that might seem like unnecessary overhead at first.

---

## Why Branches Exist

Imagine you're writing a novel with a friend. You both have copies of the manuscript. You want to add a new chapter, but you're not sure if it will work with the story. If you write directly in the main manuscript and it doesn't work out, you've made a mess for both of you.

**Branches solve this problem.**

A branch is like making a photocopy of the manuscript to experiment on. You can try your new chapter, rewrite it three times, even delete half of it - without affecting the original. When you're happy with it, you "merge" your changes back into the main manuscript.

In code:
- `main` branch = the official, working version everyone relies on
- Feature branches = your experiments and works-in-progress

**Real benefits:**
- You can work on something without fear of breaking what's live
- Multiple people can work on different features simultaneously
- Bad ideas can be abandoned without cleanup
- You can switch between tasks without losing progress

**The "works on my machine" problem:**

Without branches, you might find yourself saying "don't update yet, I'm in the middle of something!" That doesn't scale. Branches let everyone work independently and merge when ready.

---

## Why CI/CD Matters

**CI** = Continuous Integration (testing your code automatically)
**CD** = Continuous Deployment (releasing your code automatically)

### The Manual Testing Problem

Before automated testing, the release process looked like this:

1. Developer finishes feature
2. Developer tests it manually (maybe)
3. Developer says "it works"
4. Code goes to production
5. Users find the bugs

This is slow, error-prone, and doesn't scale. What if the developer forgot to test one scenario? What if they tested on a different browser? What if their change broke something unrelated?

### How CI Helps

With CI, every time you submit code:

1. A fresh computer downloads your code
2. It installs all dependencies from scratch
3. It runs all the tests automatically
4. It reports pass/fail within minutes

**Key insight:** The CI server doesn't have your local configuration, your saved passwords, or your customizations. If it works on CI, it will probably work for users.

### Why This Project Uses CI

This project has 41 Playwright tests that:
- Load the viewer
- Click buttons
- Drag to adjust window/level
- Navigate slices
- Verify the image changes correctly

Running these manually would be tedious and error-prone. CI runs them automatically on every pull request, catching bugs before they reach users.

---

## Why Preview Environments

**Scenario:** You're working on a visual change - say, redesigning the toolbar. You push your code, CI passes, you merge. The live site updates. Users see... something different from what you saw.

**Why?** Maybe your local CSS was cached. Maybe you were testing on a different screen size. Maybe you forgot to commit one file.

### Preview Environments Solve This

With preview environments (we use Vercel):

1. You push a branch
2. A separate copy of the site deploys automatically
3. You get a unique URL like `dicom-viewer-git-feature-toolbar.vercel.app`
4. You can test your changes in a real environment before merging

**Benefits:**
- See exactly what users will see
- Share the URL with others for feedback
- Test on different devices/browsers
- Catch deployment issues before they hit production

---

## Why Code Review (Pull Requests)

Even when working alone, the pull request process provides value.

### The "Fresh Eyes" Problem

You've been staring at code for hours. You know what it *should* do. You read what you *meant* to write. You miss the typo, the edge case, the logical error.

A pull request creates a **pause point**. Even if you're going to merge your own PR, the act of:
1. Writing a description
2. Reviewing the diff
3. Thinking "would this make sense to someone else?"

...catches bugs you'd otherwise miss.

### What Pull Requests Capture

- **What changed**: A diff showing exact code changes
- **Why it changed**: Your description explaining the purpose
- **When it changed**: A timestamp for future debugging
- **What state tests were in**: CI results at time of merge

This history is invaluable when something breaks later and you need to figure out what went wrong.

---

## How Teams Use This

With multiple developers, these practices become essential.

### Without Good Practices

Developer A: "I'm working on the login page"
Developer B: "Me too, I'm fixing a bug there"
*Both edit the same file*
Developer A: "My changes are gone!"
Developer B: "Mine too! What happened?"

### With Good Practices

Developer A: Creates `feature/login-redesign` branch
Developer B: Creates `fix/login-validation` branch

*Both work independently*

Developer A: Opens PR, CI passes, merges to main
Developer B: Updates branch from main, resolves any conflicts, opens PR

*Clean history, no lost work, everyone knows what changed and why*

### Code Review in Teams

Teams add another layer: someone else reviews your code before merge. This:
- Catches bugs you missed
- Shares knowledge (now two people understand the code)
- Maintains consistency (one person doesn't drift from team standards)
- Documents reasoning (review comments explain tricky decisions)

---

## The Deployment Pipeline

Here's how code travels from your laptop to users:

```
Your laptop
    |
    | git push
    v
GitHub (stores code)
    |
    |--> GitHub Actions (runs tests)
    |
    |--> Vercel (creates preview)
    v
Pull Request (review + discussion)
    |
    | merge
    v
main branch (GitHub)
    |
    | automatic
    v
GitHub Pages (users see changes)
```

**Key principle:** Each step is automatic and verified. No "I forgot to upload the file" or "I deployed from the wrong branch."

---

## Why This Isn't Overkill

You might think: "This is a lot of ceremony for a side project."

Consider what you're protecting against:

### Without CI
- You break something and don't know until a user complains
- You can't confidently make changes because you might break something
- You spend time manually testing instead of building

### Without Branches
- You can't experiment safely
- You can't switch between tasks
- Your work-in-progress is visible to everyone (and might break things)

### Without Preview Environments
- "Works on my machine" surprises
- Can't show work to others without merging
- Deployment issues only discovered in production

### Without Pull Requests
- No record of why changes were made
- No pause point to catch mistakes
- Harder to find when bugs were introduced

### The Cost of Not Having This

Real stories from teams that learned the hard way:

**The Friday Deploy:** Developer pushes directly to production at 5 PM Friday. Bug discovered Saturday. No one knows exactly what changed. Weekend ruined.

**The Lost Feature:** Developer works for a week on a feature. Colleague updates and accidentally overwrites changes. No branch history. Week of work lost.

**The Deployment Lottery:** "It works locally but not in production." Hours spent debugging environment differences that would have been caught by CI.

The "overhead" of good practices is almost always less than the cost of not having them.

---

## Applying This to Your Own Projects

You don't need perfect infrastructure from day one. Start with:

1. **Use branches** - Even if it's just you, get in the habit
2. **Write tests** - Even a few tests that run automatically catch regressions
3. **Use pull requests** - Review your own code before merging
4. **Automate what you can** - GitHub Actions is free for public repos

The goal isn't ceremony for its own sake. The goal is:
- **Confidence** - Know your code works
- **History** - Know what changed and why
- **Recovery** - Undo mistakes easily
- **Collaboration** - Work with others without chaos

---

## Summary

| Practice | What It Is | Why It Matters |
|----------|-----------|----------------|
| Branches | Separate workspaces for different tasks | Work safely, switch contexts, experiment freely |
| CI | Automatic testing on every change | Catch bugs before users do |
| Preview Environments | Temporary deployments for each PR | See exactly what users will see |
| Pull Requests | Formal review process before merge | Catch mistakes, document decisions, create history |
| CD | Automatic deployment after merge | No manual steps, consistent process |

These practices compound. Each one makes the others more effective. Together, they create a development process that:
- Scales from solo developer to large team
- Catches bugs early when they're cheap to fix
- Creates documentation automatically
- Allows confident, rapid iteration

---

## Further Reading

- [GitHub Flow](https://guides.github.com/introduction/flow/) - The branching model we use
- [The Twelve-Factor App](https://12factor.net/) - Principles for modern web apps
- [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) - Martin Fowler's classic article

---

*Last updated: 2026-02-01*
