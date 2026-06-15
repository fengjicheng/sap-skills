using { sap.skills.fixture as fixture } from '../db/schema';

service CatalogService {
  entity Books as projection on fixture.Books;
  entity Authors as projection on fixture.Authors;
}
