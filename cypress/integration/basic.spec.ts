/// <reference path="../support/index.d.ts" />

it("works", () => {
  cy.qes().should("eq", 2);
});
