/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable {
    qes(input?: any): Chainable<any>;
  }

  interface ApplicationWindow {
    QES_INPUT?: any;
    QES_OUTPUT?: any;
  }
}
