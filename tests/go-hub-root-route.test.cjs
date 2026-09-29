"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

test("root route never guesses legacy when legacy reality cannot be inspected", async()=>{
  const {chooseRootDestination}=await import("../go-hub-root-route.js?unknown="+Date.now());
  assert.equal(chooseRootDestination({canInspectLegacy:false}),"UNKNOWN");
  assert.equal(chooseRootDestination({canInspectLegacy:false,forceHub:true}),"HUB");
  assert.equal(chooseRootDestination({canInspectLegacy:false,forceLegacy:true}),"LEGACY");
});

test("root route chooses from observed legacy reality only when inspection is available", async()=>{
  const {chooseRootDestination}=await import("../go-hub-root-route.js?observed="+Date.now());
  assert.equal(chooseRootDestination({canInspectLegacy:true,legacyData:true}),"LEGACY");
  assert.equal(chooseRootDestination({canInspectLegacy:true,legacyData:false}),"HUB");
});
