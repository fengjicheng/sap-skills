namespace sap.skills.fixture;

using { cuid, managed } from '@sap/cds/common';

entity Books : cuid, managed {
  title  : String(111);
  author : Association to Authors;
}

entity Authors : cuid {
  name : String(111);
}
