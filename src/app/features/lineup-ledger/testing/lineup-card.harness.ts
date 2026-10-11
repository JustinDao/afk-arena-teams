import { ComponentHarness } from '@angular/cdk/testing';
import { MatButtonHarness } from '@angular/material/button/testing';

export class LineupCardHarness extends ComponentHarness {
  static hostSelector = '.card';

  private readonly titleElement = this.locatorFor('h3');
  private readonly voteButton = this.locatorFor(MatButtonHarness.with({ selector: '.vote' }));

  async title(): Promise<string> {
    return (await this.titleElement()).text();
  }

  async clickVote(): Promise<void> {
    await (await this.voteButton()).click();
  }
}
